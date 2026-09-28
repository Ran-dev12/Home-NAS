import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import exifr from 'exifr';
import type { Runtime } from '../runtime.ts';
import { FailureLimiter, clientIp, randomToken, requireUser, sha256 } from '../auth.ts';
import { HttpError, badRequest, notFound, str } from '../http.ts';
import { joinRel, normalizeRel, sanitizeName, toAbs, uniqueName } from '../paths.ts';
import { homeRoot } from '../spaces.ts';
import { statEntry } from '../indexer.ts';
import { commitFile, discard, receiveMultipart } from '../upload.ts';
import { lanAddresses } from '../net.ts';
import { logActivity } from '../activity.ts';
import { kindOf } from '../kinds.ts';
import { EXIF_READ_MAX, isScreenshot, readHead } from '../media.ts';
import { moveToTrash } from '../trash.ts';
import {
  BEGINNING,
  afterUpload,
  completeRun,
  freshRun,
  monthFolder,
  parseTakenAt,
  serverOffsetMin,
  sinceFor,
  type DeviceSyncState,
} from '../sync.ts';

const GB = 1024 ** 3;

export interface DeviceRow extends DeviceSyncState {
  id: number;
  user_id: number;
  name: string;
  folder: string;
  token_hash: string;
  token_hint: string;
  created_at: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  batch_limit: number;
  run_started_at: string | null;
  run_stored: number;
  run_skipped: number;
  run_bytes: number;
  total_files: number;
  total_bytes: number;
  order_warning: number;
  revoked: number;
  backup_photos: number;
  backup_videos: number;
  backup_screenshots: number;
  backup_files: number;
  run_excluded: number;
}

/** What a phone backs up. Photos, videos and screenshots come from the Photos app; files from the Files app. */
export interface BackupChoice {
  photos: boolean;
  videos: boolean;
  screenshots: boolean;
  files: boolean;
}

type MediaKind = 'photos' | 'videos' | 'screenshots';

/** Top-level folders inside each phone's backup folder. */
const SUBFOLDER = { photos: 'Photos', videos: 'Videos', screenshots: 'Screenshots', files: 'Files' } as const;

function backupOf(d: DeviceRow): BackupChoice {
  return { photos: !!d.backup_photos, videos: !!d.backup_videos, screenshots: !!d.backup_screenshots, files: !!d.backup_files };
}

function parseBackup(v: unknown, current: BackupChoice): BackupChoice {
  if (v === undefined || v === null) return current;
  if (typeof v !== 'object') throw badRequest('backup must be an object');
  const o = v as Record<string, unknown>;
  const pick = (k: keyof BackupChoice) => (o[k] === undefined ? current[k] : o[k] === true);
  const out = { photos: pick('photos'), videos: pick('videos'), screenshots: pick('screenshots'), files: pick('files') };
  if (!out.photos && !out.videos && !out.screenshots && !out.files) throw badRequest('Choose at least one thing to back up');
  return out;
}

const EXT_FOR_MIME: Record<string, string> = {
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/quicktime': '.mov',
  'video/mp4': '.mp4',
};

/** Where phones should send things: the configured public URL, else the best LAN address. */
export function baseUrlFor(rt: Runtime, req: Request): { baseUrl: string; candidates: string[] } {
  const port = rt.config.port;
  const candidates = lanAddresses().map((a) => `http://${a.address}:${port}`);
  const configured = rt.settings().publicUrl.replace(/\/+$/, '');
  const host = req.get('host') ?? '';
  const viaLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const baseUrl = configured || (viaLocalhost ? candidates[0] : `${req.protocol}://${host}`) || `http://localhost:${port}`;
  return { baseUrl, candidates };
}

function publicDevice(d: DeviceRow) {
  return {
    id: d.id,
    userId: d.user_id,
    name: d.name,
    folder: d.folder,
    tokenHint: d.token_hint,
    createdAt: d.created_at,
    lastSeenAt: d.last_seen_at,
    lastSyncAt: d.last_sync_at,
    backedUpThrough: d.cursor,
    batchLimit: d.batch_limit,
    lastRun: { stored: d.run_stored, skipped: d.run_skipped, excluded: d.run_excluded, bytes: d.run_bytes, startedAt: d.run_started_at },
    totalFiles: d.total_files,
    totalBytes: d.total_bytes,
    orderWarning: !!d.order_warning,
    backup: backupOf(d),
  };
}

/** Make the folders a phone's choices will fill, so the tree is visible before the first backup. */
function makeBackupFolders(home: string, d: { folder: string }, b: BackupChoice) {
  for (const k of ['photos', 'videos', 'screenshots', 'files'] as const) {
    if (b[k]) fs.mkdirSync(toAbs(home, joinRel(d.folder, SUBFOLDER[k])), { recursive: true });
  }
}

/** A value from a Shortcut, which may arrive as text or a number (File Size). */
function shortcutText(v: unknown, name: string, max = 300): string {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw badRequest(`${name} is too long`);
  return s;
}

/** Dates as UTC when they parse, so a phone that changes time zone still matches its earlier runs. */
function normalizeWhen(raw: string): string {
  return parseTakenAt(raw, null)?.date.toISOString() ?? raw;
}

/** "Documents" or "Work/Scans" typed in the shortcut, made safe as a folder path under Files/. */
function filesFolder(raw: unknown): string {
  const segs = shortcutText(raw, 'folder')
    .split(/[/\\]+/)
    .map((s) => sanitizeName(s.trim(), ''))
    .filter(Boolean)
    .slice(0, 5);
  return segs.length ? segs.join('/') : 'From iPhone';
}

interface FileFacts {
  folder: string;
  name: string;
  created: string;
  modified: string;
  signature: string;
}

function fileFacts(body: Record<string, unknown> | undefined): FileFacts {
  const name = shortcutText(body?.name, 'name');
  if (!name) throw badRequest('name is required (the file’s Name)');
  const created = normalizeWhen(shortcutText(body?.created, 'created'));
  const modified = normalizeWhen(shortcutText(body?.modified, 'modified'));
  const size = shortcutText(body?.size, 'size', 60);
  return { folder: filesFolder(body?.folder), name, created, modified, signature: `${modified}|${size}` };
}

interface DeviceFileRow {
  signature: string;
  path: string;
}

function startCursor(v: unknown): string | null {
  if (v === undefined || v === null || v === '' || v === 'everything') return null;
  if (v === 'now') return new Date().toISOString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  throw badRequest('startFrom must be "everything", "now" or a date like 2026-01-31');
}

async function exifDate(abs: string): Promise<Date | null> {
  try {
    const x = await exifr.parse(await readHead(abs, EXIF_READ_MAX), { pick: ['DateTimeOriginal', 'CreateDate'] } as never);
    const d = x?.DateTimeOriginal ?? x?.CreateDate;
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

const PAIR_MINUTES = 30;

export function deviceRoutes(rt: Runtime): Router {
  const r = Router();
  const tokenLimiter = new FailureLimiter(20, 15 * 60_000);
  const committing = new Set<string>();
  // Pairing codes let the phone open a page with the token ready to copy (scan a QR instead of typing
  // 40 characters). Held in memory only, so a restart or 30 minutes makes them useless.
  const pairings = new Map<string, { token: string; deviceId: number; expires: number }>();

  function newPairing(req: Request, token: string, deviceId: number) {
    const now = Date.now();
    for (const [k, v] of pairings) if (v.expires < now || v.deviceId === deviceId) pairings.delete(k);
    const code = randomToken(16);
    const expires = now + PAIR_MINUTES * 60_000;
    pairings.set(code, { token, deviceId, expires });
    return { pairUrl: `${baseUrlFor(rt, req).baseUrl}/pair/${code}`, pairExpiresAt: new Date(expires).toISOString() };
  }

  const getDevice = (id: number) => rt.requireDb().prepare('SELECT * FROM devices WHERE id = ?').get(id) as unknown as DeviceRow | undefined;

  function ownDevice(req: Request): DeviceRow {
    const d = getDevice(Number(req.params.id));
    if (!d || (d.user_id !== req.user!.id && req.user!.role !== 'admin')) throw notFound('Phone not found');
    return d;
  }

  function saveSync(id: number, s: DeviceSyncState) {
    rt.requireDb()
      .prepare('UPDATE devices SET cursor = ?, tz_offset = ?, run_base = ?, run_last = ?, run_max = ?, run_monotonic = ? WHERE id = ?')
      .run(s.cursor, s.tz_offset, s.run_base, s.run_last, s.run_max, s.run_monotonic, id);
  }

  // ---- Managed from the web UI ---------------------------------------------------------------------

  r.get('/api/devices', requireUser, (req, res) => {
    const db = rt.requireDb();
    const all = req.user!.role === 'admin' && req.query.all === '1';
    const rows = (
      all
        ? db.prepare('SELECT d.*, u.display_name AS owner FROM devices d JOIN users u ON u.id = d.user_id ORDER BY d.created_at').all()
        : db.prepare('SELECT d.*, NULL AS owner FROM devices d WHERE d.user_id = ? ORDER BY d.created_at').all(req.user!.id)
    ) as unknown as (DeviceRow & { owner: string | null })[];
    res.json({ devices: rows.map((d) => ({ ...publicDevice(d), owner: d.owner })), ...baseUrlFor(rt, req) });
  });

  r.post('/api/devices', requireUser, (req, res) => {
    const db = rt.requireDb();
    const name = str(req.body?.name, 'name', { max: 60 }).trim();
    if (!name) throw badRequest('Give the phone a name');
    const cursor = startCursor(req.body?.startFrom);
    const limit = Math.min(Math.max(Number(req.body?.batchLimit) || 300, 10), 2000);
    const backup = parseBackup(req.body?.backup, { photos: true, videos: true, screenshots: true, files: false });
    const home = homeRoot(rt, req.user!.username);
    const backupRoot = toAbs(home, '/Phone Backup');
    fs.mkdirSync(backupRoot, { recursive: true });
    // Two phones called "iPhone" get separate folders.
    const taken = new Set((db.prepare('SELECT folder FROM devices WHERE user_id = ?').all(req.user!.id) as { folder: string }[]).map((d) => d.folder.toLowerCase()));
    let folderName = sanitizeName(name, 'Phone');
    for (let i = 2; taken.has(`/phone backup/${folderName.toLowerCase()}`); i++) folderName = `${sanitizeName(name, 'Phone')} (${i})`;
    const folder = joinRel('/Phone Backup', folderName);
    const token = `hn_${randomToken(24)}`;
    const info = db
      .prepare(
        `INSERT INTO devices (user_id, name, folder, token_hash, token_hint, created_at, cursor, batch_limit,
           backup_photos, backup_videos, backup_screenshots, backup_files)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.user!.id,
        name,
        folder,
        sha256(token),
        token.slice(-4),
        new Date().toISOString(),
        cursor,
        limit,
        +backup.photos,
        +backup.videos,
        +backup.screenshots,
        +backup.files,
      );
    fs.mkdirSync(toAbs(home, folder), { recursive: true });
    makeBackupFolders(home, { folder }, backup);
    logActivity(rt, { userId: req.user!.id, action: 'device_added', space: `u:${req.user!.id}`, path: folder, detail: name });
    const id = Number(info.lastInsertRowid);
    res.json({ device: publicDevice(getDevice(id)!), token, ...baseUrlFor(rt, req), ...newPairing(req, token, id) });
  });

  r.patch('/api/devices/:id', requireUser, (req, res) => {
    const d = ownDevice(req);
    const db = rt.requireDb();
    if (req.body?.name !== undefined) {
      const name = str(req.body.name, 'name', { max: 60 }).trim();
      if (!name) throw badRequest('Give the phone a name');
      db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, d.id);
    }
    if (req.body?.batchLimit !== undefined) {
      db.prepare('UPDATE devices SET batch_limit = ? WHERE id = ?').run(Math.min(Math.max(Number(req.body.batchLimit) || 300, 10), 2000), d.id);
    }
    if (req.body?.backup !== undefined) {
      const b = parseBackup(req.body.backup, backupOf(d));
      db.prepare('UPDATE devices SET backup_photos = ?, backup_videos = ?, backup_screenshots = ?, backup_files = ? WHERE id = ?').run(
        +b.photos,
        +b.videos,
        +b.screenshots,
        +b.files,
        d.id,
      );
      const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(d.user_id) as { username: string };
      makeBackupFolders(homeRoot(rt, owner.username), d, b);
    }
    if (req.body?.resetFrom !== undefined) {
      // "Back up again from…": the next runs re-send from that date; server-side dedup skips what is already here.
      const cursor = startCursor(req.body.resetFrom);
      db.prepare('UPDATE devices SET cursor = ?, run_base = ?, order_warning = 0 WHERE id = ?').run(cursor, cursor, d.id);
    }
    res.json({ device: publicDevice(getDevice(d.id)!) });
  });

  r.post('/api/devices/:id/token', requireUser, (req, res) => {
    const d = ownDevice(req);
    const token = `hn_${randomToken(24)}`;
    rt.requireDb().prepare('UPDATE devices SET token_hash = ?, token_hint = ? WHERE id = ?').run(sha256(token), token.slice(-4), d.id);
    res.json({ token, device: publicDevice(getDevice(d.id)!), ...baseUrlFor(rt, req), ...newPairing(req, token, d.id) });
  });

  /** Opened on the phone itself (from the QR code); no login, the unguessable code is the credential. */
  r.get('/api/pair/:code', (req, res) => {
    const p = pairings.get(String(req.params.code));
    if (!p || p.expires < Date.now()) throw notFound('This setup link has expired. On the PC, open Phones and choose "New token" to get a fresh one.');
    const d = getDevice(p.deviceId);
    if (!d || sha256(p.token) !== d.token_hash) throw notFound('This setup link is no longer valid');
    res.json({
      deviceName: d.name,
      token: p.token,
      batchLimit: d.batch_limit,
      backup: backupOf(d),
      serverName: rt.settings().serverName,
      baseUrl: baseUrlFor(rt, req).baseUrl,
      expiresAt: new Date(p.expires).toISOString(),
    });
  });

  /** Forget the phone. Its photos stay where they are. */
  r.delete('/api/devices/:id', requireUser, (req, res) => {
    const d = ownDevice(req);
    rt.requireDb().prepare('DELETE FROM devices WHERE id = ?').run(d.id);
    logActivity(rt, { userId: req.user!.id, action: 'device_removed', detail: d.name });
    res.json({ ok: true });
  });

  // ---- Called by the iOS Shortcut (Authorization: Bearer <token>) -----------------------------------

  function deviceAuth(req: Request, _res: Response, next: NextFunction) {
    const ip = clientIp(req);
    tokenLimiter.check(ip);
    // Keys look like hn_<base64url>. Find one anywhere in the header, so "hn_…" without "Bearer", or a key
    // pasted next to leftover placeholder text, still works.
    const header = `${req.get('authorization') ?? ''} ${req.get('x-device-token') ?? ''}`;
    const token = /hn_[A-Za-z0-9_-]+/.exec(header)?.[0] ?? '';
    const row = token
      ? (rt.requireDb()
          .prepare('SELECT d.*, u.disabled AS user_disabled FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?')
          .get(sha256(token)) as unknown as (DeviceRow & { user_disabled: number }) | undefined)
      : undefined;
    if (!row || row.revoked || row.user_disabled) {
      tokenLimiter.fail(ip);
      return next(new HttpError(401, 'bad_device_token', 'This phone is not recognised. Open HomeNAS → Phones and copy the token again.'));
    }
    req.device = row;
    rt.requireDb().prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    next();
  }

  r.get('/api/device/sync-state', deviceAuth, (req, res) => {
    const d = req.device!;
    const fresh = freshRun(d);
    saveSync(d.id, fresh);
    rt.requireDb()
      .prepare('UPDATE devices SET run_started_at = ?, run_stored = 0, run_skipped = 0, run_excluded = 0, run_bytes = 0 WHERE id = ?')
      .run(new Date().toISOString(), d.id);
    const { since, sinceIso } = sinceFor(fresh);
    rt.log(`${d.name} started a backup (from ${clientIp(req)}).`);
    res.json({
      ok: true,
      device: d.name,
      since,
      sinceIso,
      limit: d.batch_limit,
      folder: d.folder,
      serverTime: new Date().toISOString(),
    });
  });

  r.post('/api/device/upload', deviceAuth, async (req, res) => {
    const dev = req.device!;
    const owner = rt.requireDb().prepare('SELECT id, username FROM users WHERE id = ?').get(dev.user_id) as { id: number; username: string };
    const home = homeRoot(rt, owner.username);
    const space = `u:${owner.id}`;
    const s = rt.settings();
    const rec = await receiveMultipart(req, {
      tmpDir: rt.paths.tmp,
      volumeRoot: rt.root,
      maxFileBytes: s.maxUploadGb * GB,
      minFreeBytes: s.minFreeGb * GB,
      maxFiles: 1,
    });
    const file = rec.files[0];
    if (!file) throw badRequest('No file in the upload. The form field must be a File named "file".');

    // Re-read after the (long) upload: other requests may have moved the cursor meanwhile.
    const current = getDevice(dev.id)!;
    const parsed = parseTakenAt(rec.fields.takenAt ?? rec.fields.date ?? rec.fields.creationDate, current.tz_offset);
    const offset = parsed?.offsetMin ?? current.tz_offset ?? serverOffsetMin();
    const takenAt = parsed?.date ?? (await exifDate(file.tmpPath)) ?? new Date();
    const media: MediaKind =
      file.mime.startsWith('video/') || kindOf(file.filename, false) === 'video' ? 'videos' : (await isScreenshot(file.tmpPath)) ? 'screenshots' : 'photos';

    const dupKey = `${space}:${file.sha256}`;
    const db = rt.requireDb();
    const dup = db.prepare('SELECT path FROM files WHERE space = ? AND sha256 = ? LIMIT 1').get(space, file.sha256) as { path: string } | undefined;
    let status: 'stored' | 'duplicate' | 'excluded';
    let rel: string;
    if (!backupOf(current)[media]) {
      // Turned off for this phone. Still counts as handled, so the bookmark moves past it.
      discard([file]);
      status = 'excluded';
      rel = '';
    } else if (committing.has(dupKey) || (dup && fs.existsSync(toAbs(home, dup.path)))) {
      discard([file]);
      status = 'duplicate';
      rel = dup?.path ?? '';
    } else {
      committing.add(dupKey);
      try {
        const { year, month } = monthFolder(takenAt, offset);
        const dirRel = normalizeRel(`${current.folder}/${SUBFOLDER[media]}/${year}/${month}`);
        const dirAbs = toAbs(home, dirRel);
        fs.mkdirSync(dirAbs, { recursive: true });
        let name = sanitizeName(file.filename !== 'upload' ? file.filename : rec.fields.filename || 'IMG', 'IMG');
        if (!path.extname(name) && EXT_FOR_MIME[file.mime]) name += EXT_FOR_MIME[file.mime];
        name = uniqueName(dirAbs, name);
        rel = joinRel(dirRel, name);
        const abs = path.join(dirAbs, name);
        await commitFile(file, abs, takenAt); // file date in Explorer = when the photo was taken
        rt.indexer.upsert(space, rel, statEntry(abs, name)!, { sha256: file.sha256, takenAt: takenAt.toISOString() });
        status = 'stored';
      } catch (err) {
        discard([file]);
        throw err;
      } finally {
        committing.delete(dupKey);
      }
    }

    const latest = getDevice(dev.id)!;
    const next = afterUpload({ ...latest, tz_offset: parsed?.offsetMin ?? latest.tz_offset }, takenAt);
    saveSync(dev.id, next);
    if (status === 'stored') {
      db.prepare(
        'UPDATE devices SET run_stored = run_stored + 1, run_bytes = run_bytes + ?, total_files = total_files + 1, total_bytes = total_bytes + ? WHERE id = ?',
      ).run(file.size, file.size, dev.id);
    } else if (status === 'excluded') {
      db.prepare('UPDATE devices SET run_excluded = run_excluded + 1 WHERE id = ?').run(dev.id);
    } else {
      db.prepare('UPDATE devices SET run_skipped = run_skipped + 1 WHERE id = ?').run(dev.id);
    }
    rt.events.emit('device', { deviceId: dev.id, status, path: rel, name: path.basename(rel) }, { userIds: [dev.user_id] });
    const message = status === 'stored' ? 'Saved' : status === 'duplicate' ? 'Already backed up' : `Not backed up: ${SUBFOLDER[media].toLowerCase()} are turned off for this phone`;
    res.json({ ok: true, status, path: rel, message });
  });

  // ---- Files and folders from the iPhone's Files app -------------------------------------------------
  // For each file the shortcut first asks "do you need this?" with its name and dates (cheap), and uploads
  // only when the answer carries an upload URL. The URL holds a one-time ticket with what the check learned.

  const tickets = new Map<string, FileFacts & { deviceId: number; expires: number }>();
  const TICKET_MS = 6 * 3600_000;

  const findDeviceFile = (deviceId: number, f: FileFacts) =>
    rt
      .requireDb()
      .prepare('SELECT signature, path FROM device_files WHERE device_id = ? AND folder = ? AND name = ? AND created = ?')
      .get(deviceId, f.folder, f.name, f.created) as DeviceFileRow | undefined;

  r.post('/api/device/file-check', deviceAuth, (req, res) => {
    const d = req.device!;
    if (!d.backup_files) return res.json({ status: 'off', message: 'Files backup is turned off for this phone' });
    const f = fileFacts(req.body);
    const owner = rt.requireDb().prepare('SELECT username FROM users WHERE id = ?').get(d.user_id) as { username: string };
    const row = findDeviceFile(d.id, f);
    const present = !!row && fs.existsSync(toAbs(homeRoot(rt, owner.username), row.path));
    if (present && row.signature === f.signature) return res.json({ status: 'unchanged' });

    const now = Date.now();
    if (tickets.size > 20_000) for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
    const ticket = randomToken(18);
    tickets.set(ticket, { ...f, deviceId: d.id, expires: now + TICKET_MS });
    // The phone reached us through this host, so the upload URL uses it too.
    const upload = `${req.protocol}://${req.get('host')}/api/device/file-upload?ticket=${ticket}`;
    res.json({ status: present ? 'changed' : 'new', upload });
  });

  r.post('/api/device/file-upload', deviceAuth, async (req, res) => {
    const dev = req.device!;
    const key = String(req.query.ticket ?? '');
    const t = tickets.get(key);
    if (!t || t.deviceId !== dev.id || t.expires < Date.now()) {
      throw badRequest('This upload was not expected (or the NAS restarted). The next backup sends the file again.');
    }
    const owner = rt.requireDb().prepare('SELECT id, username FROM users WHERE id = ?').get(dev.user_id) as { id: number; username: string };
    const home = homeRoot(rt, owner.username);
    const space = `u:${owner.id}`;
    const s = rt.settings();
    const rec = await receiveMultipart(req, {
      tmpDir: rt.paths.tmp,
      volumeRoot: rt.root,
      maxFileBytes: s.maxUploadGb * GB,
      minFreeBytes: s.minFreeGb * GB,
      maxFiles: 1,
    });
    const file = rec.files[0];
    if (!file) throw badRequest('No file in the upload. The form field must be a File named "file".');
    tickets.delete(key);

    const db = rt.requireDb();
    const row = findDeviceFile(dev.id, t);
    let rel: string;
    let replaced = false;
    try {
      if (row && fs.existsSync(toAbs(home, row.path))) {
        // A newer version of a file we already have: the old one goes to the trash, recoverable for a while.
        moveToTrash(rt, space, home, row.path, owner.id);
        rel = row.path;
        replaced = true;
      } else {
        const dirRel = normalizeRel(`${dev.folder}/${SUBFOLDER.files}/${t.folder}`);
        const dirAbs = toAbs(home, dirRel);
        fs.mkdirSync(dirAbs, { recursive: true });
        const name = uniqueName(dirAbs, sanitizeName(file.filename !== 'upload' ? file.filename : t.name, 'file'));
        rel = joinRel(dirRel, name);
      }
      const abs = toAbs(home, rel);
      const modified = parseTakenAt(t.modified, null)?.date;
      await commitFile(file, abs, modified); // file date on the NAS = last modified on the phone
      rt.indexer.upsert(space, rel, statEntry(abs, path.basename(abs))!, { sha256: file.sha256 });
    } catch (err) {
      discard([file]);
      throw err;
    }

    db.prepare(
      `INSERT INTO device_files (device_id, folder, name, created, signature, path, backed_up_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (device_id, folder, name, created) DO UPDATE SET signature = excluded.signature, path = excluded.path, backed_up_at = excluded.backed_up_at`,
    ).run(dev.id, t.folder, t.name, t.created, t.signature, rel, new Date().toISOString());
    db.prepare(
      'UPDATE devices SET run_stored = run_stored + 1, run_bytes = run_bytes + ?, total_files = total_files + ?, total_bytes = total_bytes + ? WHERE id = ?',
    ).run(file.size, replaced ? 0 : 1, file.size, dev.id);
    const status = replaced ? 'updated' : 'stored';
    rt.events.emit('device', { deviceId: dev.id, status, path: rel, name: path.basename(rel) }, { userIds: [dev.user_id] });
    res.json({ ok: true, status, path: rel, message: replaced ? 'Updated' : 'Saved' });
  });

  r.post('/api/device/sync-complete', deviceAuth, (req, res) => {
    const d = getDevice(req.device!.id)!;
    const { state, outOfOrder } = completeRun(d);
    saveSync(d.id, state);
    const now = new Date().toISOString();
    rt.requireDb().prepare('UPDATE devices SET last_sync_at = ?, order_warning = ? WHERE id = ?').run(now, outOfOrder ? 1 : 0, d.id);
    const name = rt.settings().serverName;
    const notes = [d.run_skipped ? `${d.run_skipped} already there` : '', d.run_excluded ? `${d.run_excluded} turned off in this phone’s settings` : ''].filter(Boolean);
    let message =
      d.run_stored > 0
        ? `Backed up ${d.run_stored} new item${d.run_stored === 1 ? '' : 's'} to ${name}` + (notes.length ? ` (${notes.join(', ')})` : '')
        : 'Everything is already backed up' + (d.run_excluded ? ` (${notes.at(-1)})` : '');
    if (outOfOrder) message += '. Warning: set Find Photos to sort by Date Taken, Oldest First.';
    if (d.run_stored + d.run_skipped + d.run_excluded > 0) {
      logActivity(rt, {
        userId: d.user_id,
        deviceId: d.id,
        action: 'phone_backup',
        space: `u:${d.user_id}`,
        path: d.folder,
        detail: `${d.name}: ${d.run_stored} new, ${d.run_skipped} already backed up` + (d.run_excluded ? `, ${d.run_excluded} turned off` : ''),
      });
    }
    rt.log(`${d.name}: ${message}.`);
    rt.events.emit('device', { deviceId: d.id, status: 'complete' }, { userIds: [d.user_id] });
    res.json({
      ok: true,
      stored: d.run_stored,
      skipped: d.run_skipped,
      excluded: d.run_excluded,
      bytes: d.run_bytes,
      backedUpThrough: state.cursor ?? BEGINNING,
      outOfOrder,
      message,
    });
  });

  return r;
}
