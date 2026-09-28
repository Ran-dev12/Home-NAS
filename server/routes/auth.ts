import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { Runtime } from '../runtime.ts';
import { openDb } from '../db.ts';
import {
  FailureLimiter,
  SESSION_COOKIE,
  checkPasswordStrength,
  clearSessionCookie,
  clientIp,
  createSession,
  destroySession,
  hashPassword,
  isLocalRequest,
  parseCookies,
  requireUser,
  setSessionCookie,
  sha256,
  validateUsername,
  verifyPassword,
} from '../auth.ts';
import { HttpError, badRequest, forbidden, str } from '../http.ts';
import { diskStats, driveOf, initVolume, listDrives, readMarker, volumePaths } from '../volume.ts';
import { listSpacesFor, homeRoot } from '../spaces.ts';
import { logActivity } from '../activity.ts';

const VERSION = '0.1.0';
const DUMMY_HASH = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(32).toString('base64')}`;

export function authRoutes(rt: Runtime): Router {
  const r = Router();
  const loginLimiter = new FailureLimiter(10, 15 * 60_000);
  const setupLimiter = new FailureLimiter(10, 15 * 60_000);

  function checkSetupAccess(req: Request, allowed: ('setup' | 'offline')[]) {
    if (!allowed.includes(rt.state as 'setup' | 'offline')) throw forbidden('HomeNAS is already set up');
    if (isLocalRequest(req)) return;
    const ip = clientIp(req);
    setupLimiter.check(ip);
    const code = String(req.body?.code ?? req.query.code ?? '');
    if (code !== rt.setupCode) {
      setupLimiter.fail(ip);
      throw new HttpError(
        403,
        'bad_setup_code',
        'Wrong setup code. It is shown where HomeNAS runs: in its window on a PC, or with “sudo journalctl -u homenas” on a Raspberry Pi.',
      );
    }
  }

  r.get('/api/status', (req, res) => {
    let serverName = 'HomeNAS';
    if (rt.state === 'online') serverName = rt.settings().serverName;
    res.json({
      state: rt.state,
      version: VERSION,
      serverName,
      user: req.user ?? null,
      offlineReason: rt.state === 'offline' ? rt.offlineReason : undefined,
      storageRoot: rt.state === 'offline' || req.user?.role === 'admin' ? rt.config.storageRoot : undefined,
      needsSetupCode: rt.state !== 'online' ? !isLocalRequest(req) : undefined,
    });
  });

  r.get('/api/setup/drives', (req, res) => {
    checkSetupAccess(req, ['setup', 'offline']);
    res.json({ drives: listDrives(), platform: process.platform });
  });

  /** Look at a candidate folder before committing to it. */
  r.post('/api/setup/inspect', (req, res) => {
    checkSetupAccess(req, ['setup', 'offline']);
    res.json(inspectFolder(str(req.body?.path, 'path', { max: 400 })));
  });

  r.post('/api/setup/complete', async (req, res) => {
    checkSetupAccess(req, ['setup']);
    const target = path.resolve(str(req.body?.path, 'path', { max: 400 }));
    const info = inspectFolder(target);
    if (info.problems.length) throw badRequest(info.problems[0]);
    if (!info.exists) fs.mkdirSync(target);

    let adminId: number | null = null;
    if (!info.existingVolume) {
      const username = validateUsername(req.body?.admin?.username);
      const password = String(req.body?.admin?.password ?? '');
      checkPasswordStrength(password);
      const displayName = str(req.body?.admin?.displayName, 'displayName', { optional: true, max: 60 }) || username;
      const volumeName = str(req.body?.volumeName, 'volumeName', { optional: true, max: 60 }) || 'HomeNAS';
      const hash = await hashPassword(password);
      initVolume(target, volumeName);
      const db = openDb(volumePaths(target).db);
      try {
        const info2 = db
          .prepare(`INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)`)
          .run(username, displayName, hash, new Date().toISOString());
        adminId = Number(info2.lastInsertRowid);
      } finally {
        db.close();
      }
      fs.mkdirSync(path.join(volumePaths(target).users, username), { recursive: true });
    }

    rt.attach(target);
    if (adminId !== null) {
      rt.updateSettings({ serverName: str(req.body?.serverName, 'serverName', { optional: true, max: 60 }) || 'HomeNAS' });
      const token = createSession(rt.requireDb(), adminId, req.get('user-agent') ?? '', clientIp(req));
      setSessionCookie(req, res, token);
      logActivity(rt, { userId: adminId, action: 'setup', detail: `Storage created at ${target}` });
    }
    rt.log(`Setup complete. Storage: ${target}`);
    res.json({ ok: true, attached: !!info.existingVolume });
  });

  /** Drive letter changed (common with USB drives): point HomeNAS at the volume's new location. */
  r.post('/api/setup/relocate', (req, res) => {
    checkSetupAccess(req, ['offline']);
    const target = path.resolve(str(req.body?.path, 'path', { max: 400 }));
    if (driveOf(target)?.kind === 'network' || /^\\\\/.test(target)) throw badRequest('Network drives are not supported. Use a drive plugged into this PC.');
    if (!readMarker(target)) throw badRequest('No HomeNAS storage was found in that folder');
    rt.attach(target);
    res.json({ ok: true });
  });

  r.post('/api/auth/login', async (req, res) => {
    const db = rt.requireDb();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const key = `${clientIp(req)}|${username}`;
    loginLimiter.check(key);
    const user = db.prepare('SELECT id, password_hash, disabled FROM users WHERE username = ?').get(username) as
      | { id: number; password_hash: string; disabled: number }
      | undefined;
    // Always run a hash so response time does not reveal whether the username exists.
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || user.disabled) {
      loginLimiter.fail(key);
      throw new HttpError(401, 'bad_credentials', user?.disabled && ok ? 'This account has been disabled' : 'Wrong username or password');
    }
    loginLimiter.reset(key);
    const token = createSession(db, user.id, req.get('user-agent') ?? '', clientIp(req));
    setSessionCookie(req, res, token);
    res.json({ ok: true });
  });

  r.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token && rt.db) destroySession(rt.db, token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.get('/api/me', requireUser, (req, res) => {
    const user = req.user!;
    res.json({ user, spaces: listSpacesFor(rt, user).map(({ root: _root, ...s }) => s), disk: diskStats(rt.root) });
  });

  r.patch('/api/me', requireUser, (req, res) => {
    const displayName = str(req.body?.displayName, 'displayName', { max: 60 }).trim();
    if (!displayName) throw badRequest('Display name cannot be empty');
    rt.requireDb().prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user!.id);
    res.json({ ok: true });
  });

  r.post('/api/me/password', requireUser, async (req, res) => {
    const db = rt.requireDb();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!(await verifyPassword(String(req.body?.current ?? ''), row.password_hash))) {
      throw new HttpError(400, 'bad_credentials', 'Current password is wrong');
    }
    const next = String(req.body?.next ?? '');
    checkPasswordStrength(next);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user!.id);
    // Sign out every other browser that was using the old password.
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user!.id, token ? sha256(token) : '');
    res.json({ ok: true });
  });

  return r;
}

export interface FolderInspection {
  path: string;
  exists: boolean;
  existingVolume: { name: string; createdAt: string } | null;
  freeBytes: number | null;
  totalBytes: number | null;
  problems: string[];
  warnings: string[];
}

export function inspectFolder(raw: string): FolderInspection {
  const p = path.resolve(raw);
  const out: FolderInspection = { path: p, exists: false, existingVolume: null, freeBytes: null, totalBytes: null, problems: [], warnings: [] };
  if (/^\\\\/.test(raw) || /^\\\\/.test(p)) {
    out.problems.push('Network paths are not supported. Use a drive that is plugged into this PC.');
    return out;
  }
  // SQLite on Windows cannot open a database whose path is longer than ~256 characters.
  if (p.length > 200) {
    out.problems.push('That folder path is too long. Pick a folder near the top of the drive, for example D:\\HomeNAS.');
    return out;
  }
  const driveRoot = path.parse(p).root;
  const drive = driveOf(p);
  const linux = process.platform !== 'win32';
  // On Linux the "drive" is its mount point (e.g. /mnt/ssd); on Windows, the letter.
  const where = linux ? (drive?.label ?? '/') : driveRoot;
  if (drive?.kind === 'network') {
    out.problems.push(
      `${where} is a network ${linux ? 'mount' : 'drive'}${drive.provider ? ` (${drive.provider})` : ''}. HomeNAS needs a disk plugged into this computer.`,
    );
    return out;
  }
  if (!fs.existsSync(driveRoot)) {
    out.problems.push(`Drive ${driveRoot} is not connected`);
    return out;
  }
  if (drive?.fileSystem === 'FAT32') {
    out.warnings.push('This drive is formatted FAT32, which cannot hold files over 4 GB. Long iPhone videos will fail. Reformat it first (exFAT works on both Windows and a Raspberry Pi).');
  } else if (drive?.fileSystem === 'exFAT') {
    out.warnings.push('This drive is exFAT. It works, but NTFS or ext4 cope better if power is lost while writing. Always eject it properly before unplugging.');
  }
  let existing = p;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const st = diskStats(existing);
  out.freeBytes = st?.freeBytes ?? null;
  out.totalBytes = st?.totalBytes ?? null;
  out.exists = fs.existsSync(p);
  if (out.exists) {
    if (!fs.statSync(p).isDirectory()) {
      out.problems.push('That path is a file, not a folder');
      return out;
    }
    const marker = readMarker(p);
    if (marker) out.existingVolume = { name: marker.name, createdAt: marker.createdAt };
    try {
      const probe = path.join(p, `.homenas-write-test-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe);
    } catch {
      out.problems.push('HomeNAS cannot write to that folder');
    }
    if (!marker) {
      const visible = fs.readdirSync(p).filter((n) => !/^(\$recycle\.bin|system volume information|\.homenas)$/i.test(n));
      if (visible.length) out.warnings.push(`The folder already has ${visible.length} item(s). They stay where they are and will not be visible in HomeNAS. An empty folder is best.`);
    }
  } else if (!fs.existsSync(path.dirname(p))) {
    out.problems.push(`The parent folder ${path.dirname(p)} does not exist`);
  }
  if (drive?.isSystem) {
    out.warnings.push(
      linux
        ? 'This folder is on the system disk (the SD card), not the SSD. Mount the SSD first (the install script can do it, for example at /mnt/ssd) and pick a folder on it.'
        : `This is on ${driveRoot.replace(/\\$/, '')}, the Windows system drive. HomeNAS is meant for the external SSD.`,
    );
  }
  if (p === driveRoot) out.warnings.push('Using the whole drive root is fine, but a folder such as HomeNAS keeps things tidy.');
  return out;
}

export function ensureHome(rt: Runtime, username: string) {
  fs.mkdirSync(homeRoot(rt, username), { recursive: true });
}
