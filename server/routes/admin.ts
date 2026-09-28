import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import type { Runtime, Settings } from '../runtime.ts';
import { checkPasswordStrength, hashPassword, requireAdmin, requireUser, validateUsername } from '../auth.ts';
import { HttpError, badRequest, conflict, notFound, str } from '../http.ts';
import { sanitizeName, uniqueName } from '../paths.ts';
import { homeRoot, listSpacesFor, sharedRoot } from '../spaces.ts';
import { diskStats } from '../volume.ts';
import { lanAddresses } from '../net.ts';
import { logActivity } from '../activity.ts';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  created_at: string;
  disabled: number;
}

interface MemberInput {
  userId: number;
  access: 'read' | 'write';
}

function membersFrom(v: unknown): MemberInput[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw badRequest('members must be a list');
  return v.map((m) => {
    const userId = Number((m as MemberInput)?.userId);
    const access = (m as MemberInput)?.access;
    if (!Number.isInteger(userId) || (access !== 'read' && access !== 'write')) throw badRequest('Each member needs a userId and read/write access');
    return { userId, access };
  });
}

export function adminRoutes(rt: Runtime): Router {
  const r = Router();
  r.use('/api/admin', requireAdmin);

  const adminCount = () =>
    (rt.requireDb().prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`).get() as { n: number }).n;

  // ---- Users ---------------------------------------------------------------------------------------

  r.get('/api/admin/users', (_req, res) => {
    const db = rt.requireDb();
    const users = db.prepare('SELECT id, username, display_name, role, created_at, disabled FROM users ORDER BY username').all() as unknown as UserRow[];
    const usage = new Map(
      (db.prepare(`SELECT space, COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files FROM files WHERE is_dir = 0 AND space LIKE 'u:%' GROUP BY space`).all() as {
        space: string;
        bytes: number;
        files: number;
      }[]).map((u) => [u.space, u]),
    );
    const lastSeen = new Map(
      (db.prepare('SELECT user_id, MAX(last_seen_at) AS at FROM sessions GROUP BY user_id').all() as { user_id: number; at: string }[]).map((s) => [s.user_id, s.at]),
    );
    const devices = new Map(
      (db.prepare('SELECT user_id, COUNT(*) AS n FROM devices GROUP BY user_id').all() as { user_id: number; n: number }[]).map((d) => [d.user_id, d.n]),
    );
    res.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        role: u.role,
        createdAt: u.created_at,
        disabled: !!u.disabled,
        usedBytes: usage.get(`u:${u.id}`)?.bytes ?? 0,
        files: usage.get(`u:${u.id}`)?.files ?? 0,
        lastSeenAt: lastSeen.get(u.id) ?? null,
        devices: devices.get(u.id) ?? 0,
      })),
    });
  });

  r.post('/api/admin/users', async (req, res) => {
    const db = rt.requireDb();
    const username = validateUsername(req.body?.username);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('That username is taken');
    const password = String(req.body?.password ?? '');
    checkPasswordStrength(password);
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    const displayName = str(req.body?.displayName, 'displayName', { optional: true, max: 60 }).trim() || username;
    // A folder with this name may survive from an earlier account; reusing it would hand over its files.
    if (fs.existsSync(homeRoot(rt, username)) && fs.readdirSync(homeRoot(rt, username)).length) {
      throw conflict(`A non-empty folder users\\${username} already exists on the drive. Pick another username or move that folder first.`);
    }
    const info = db
      .prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username, displayName, await hashPassword(password), role, new Date().toISOString());
    fs.mkdirSync(homeRoot(rt, username), { recursive: true });
    logActivity(rt, { userId: req.user!.id, action: 'user_added', detail: `${displayName} (${username}, ${role})` });
    res.json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/api/admin/users/:id', async (req, res) => {
    const db = rt.requireDb();
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) as unknown as UserRow | undefined;
    if (!u) throw notFound('User not found');
    const b = req.body ?? {};
    const isSelf = u.id === req.user!.id;
    const losingAdmin = u.role === 'admin' && !u.disabled && ((b.role !== undefined && b.role !== 'admin') || b.disabled === true);
    if (losingAdmin && adminCount() <= 1) throw new HttpError(400, 'last_admin', 'There must always be at least one active administrator');
    if (isSelf && b.disabled === true) throw badRequest('You cannot disable your own account');
    if (b.displayName !== undefined) {
      const dn = str(b.displayName, 'displayName', { max: 60 }).trim();
      if (!dn) throw badRequest('Display name cannot be empty');
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(dn, u.id);
    }
    if (b.role !== undefined) {
      if (b.role !== 'admin' && b.role !== 'member') throw badRequest('role must be admin or member');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id);
    }
    if (b.disabled !== undefined) {
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, u.id);
      if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    if (b.password !== undefined) {
      checkPasswordStrength(String(b.password));
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(b.password)), u.id);
      if (!isSelf) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    logActivity(rt, { userId: req.user!.id, action: 'user_changed', detail: u.username });
    res.json({ ok: true });
  });

  // ---- Shared folders ------------------------------------------------------------------------------

  function spaceJson(id: number) {
    const db = rt.requireDb();
    const s = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) as { id: number; name: string; folder: string; created_at: string } | undefined;
    if (!s) return null;
    const members = db
      .prepare('SELECT m.user_id AS userId, m.access, u.display_name AS displayName, u.username FROM space_members m JOIN users u ON u.id = m.user_id WHERE m.space_id = ? ORDER BY u.username')
      .all(id);
    const use = db.prepare(`SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files FROM files WHERE space = ? AND is_dir = 0`).get(`s:${id}`) as { bytes: number; files: number };
    return { id: `s:${s.id}`, numericId: s.id, name: s.name, folder: s.folder, createdAt: s.created_at, members, usedBytes: use.bytes, files: use.files };
  }

  function setMembers(spaceId: number, members: MemberInput[]) {
    const db = rt.requireDb();
    db.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
    const ins = db.prepare('INSERT OR REPLACE INTO space_members (space_id, user_id, access) VALUES (?, ?, ?)');
    for (const m of members) {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(m.userId)) throw badRequest(`Unknown user ${m.userId}`);
      ins.run(spaceId, m.userId, m.access);
    }
  }

  r.get('/api/admin/spaces', (_req, res) => {
    const ids = rt.requireDb().prepare('SELECT id FROM spaces ORDER BY name').all() as { id: number }[];
    res.json({ spaces: ids.map((s) => spaceJson(s.id)) });
  });

  r.post('/api/admin/spaces', (req, res) => {
    const db = rt.requireDb();
    const name = str(req.body?.name, 'name', { max: 60 }).trim();
    if (!name) throw badRequest('Give the shared folder a name');
    if (db.prepare('SELECT 1 FROM spaces WHERE name = ?').get(name)) throw conflict('A shared folder with that name exists');
    const members = membersFrom(req.body?.members);
    fs.mkdirSync(rt.paths.shared, { recursive: true });
    const folder = uniqueName(rt.paths.shared, sanitizeName(name, 'Shared'));
    fs.mkdirSync(sharedRoot(rt, folder));
    const info = db.prepare('INSERT INTO spaces (name, folder, created_at) VALUES (?, ?, ?)').run(name, folder, new Date().toISOString());
    const id = Number(info.lastInsertRowid);
    setMembers(id, members);
    logActivity(rt, { userId: req.user!.id, action: 'space_added', detail: name });
    res.json({ space: spaceJson(id) });
  });

  r.patch('/api/admin/spaces/:id', (req, res) => {
    const db = rt.requireDb();
    const id = Number(req.params.id);
    if (!spaceJson(id)) throw notFound('Shared folder not found');
    if (req.body?.name !== undefined) {
      const name = str(req.body.name, 'name', { max: 60 }).trim();
      if (!name) throw badRequest('Name cannot be empty');
      const clash = db.prepare('SELECT id FROM spaces WHERE name = ? AND id != ?').get(name, id);
      if (clash) throw conflict('A shared folder with that name exists');
      db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(name, id); // display name only; the folder on disk keeps its name
    }
    if (req.body?.members !== undefined) setMembers(id, membersFrom(req.body.members));
    res.json({ space: spaceJson(id) });
  });

  r.delete('/api/admin/spaces/:id', (req, res) => {
    const db = rt.requireDb();
    const s = spaceJson(Number(req.params.id));
    if (!s) throw notFound('Shared folder not found');
    const root = sharedRoot(rt, s.folder);
    if (fs.existsSync(root) && fs.readdirSync(root).length) {
      throw conflict('The shared folder is not empty. Move or delete its contents first.');
    }
    if (fs.existsSync(root)) fs.rmdirSync(root);
    db.prepare('DELETE FROM spaces WHERE id = ?').run(s.numericId);
    db.prepare('DELETE FROM files WHERE space = ?').run(s.id);
    db.prepare('UPDATE share_links SET revoked = 1 WHERE space = ?').run(s.id);
    logActivity(rt, { userId: req.user!.id, action: 'space_removed', detail: s.name });
    res.json({ ok: true });
  });

  // ---- Settings & system ---------------------------------------------------------------------------

  r.get('/api/admin/settings', (_req, res) => res.json({ settings: rt.settings() }));

  r.patch('/api/admin/settings', (req, res) => {
    const b = req.body ?? {};
    const patch: Partial<Settings> = {};
    if (b.serverName !== undefined) {
      const v = str(b.serverName, 'serverName', { max: 60 }).trim();
      if (!v) throw badRequest('Server name cannot be empty');
      patch.serverName = v;
    }
    if (b.publicUrl !== undefined) {
      const v = str(b.publicUrl, 'publicUrl', { optional: true, max: 200 }).trim().replace(/\/+$/, '');
      if (v && !/^https?:\/\/[^\s/]+$/i.test(v)) throw badRequest('Public URL must look like http://192.168.1.20:4300 (no path)');
      patch.publicUrl = v;
    }
    const num = (k: keyof Settings, min: number, max: number) => {
      if (b[k] === undefined) return;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${k} must be between ${min} and ${max}`);
      (patch as Record<string, number>)[k] = n;
    };
    num('trashDays', 0, 3650);
    num('maxUploadGb', 1, 10_000);
    num('minFreeGb', 0, 1000);
    num('scanMinutes', 5, 1440);
    res.json({ settings: rt.updateSettings(patch) });
  });

  r.get('/api/admin/system', (_req, res) => {
    const db = rt.requireDb();
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    res.json({
      volume: { root: rt.root, name: rt.marker?.name, id: rt.marker?.id, createdAt: rt.marker?.createdAt, disk: diskStats(rt.root) },
      index: {
        files: count('SELECT COUNT(*) AS n FROM files WHERE is_dir = 0'),
        folders: count('SELECT COUNT(*) AS n FROM files WHERE is_dir = 1'),
        photos: count(`SELECT COUNT(*) AS n FROM files WHERE kind = 'image'`),
        videos: count(`SELECT COUNT(*) AS n FROM files WHERE kind = 'video'`),
        bytes: count('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE is_dir = 0'),
        mediaPending: count(`SELECT COUNT(*) AS n FROM files WHERE media_state = 'pending'`),
        mediaErrors: count(`SELECT COUNT(*) AS n FROM files WHERE media_state = 'error'`),
        scanning: rt.indexer.scanning,
        scanProgress: rt.indexer.progress,
        lastScan: rt.indexer.lastScan,
      },
      trash: {
        items: count('SELECT COUNT(*) AS n FROM trash'),
        bytes: count('SELECT COALESCE(SUM(size), 0) AS n FROM trash'),
      },
      server: {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        node: process.version,
        uptimeSec: Math.round((Date.now() - rt.startedAt) / 1000),
        port: rt.config.port,
        lan: lanAddresses(),
        ffmpeg: !!rt.tools.ffmpeg,
        ffprobe: !!rt.tools.ffprobe,
      },
    });
  });

  r.post('/api/admin/rescan', (_req, res) => {
    void rt.indexer.scanAll().catch((err) => rt.log('Rescan failed:', err));
    res.json({ ok: true });
  });

  // ---- Activity (everyone sees their own; admins see everything) -------------------------------------

  r.get('/api/activity', requireUser, (req, res) => {
    const db = rt.requireDb();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const user = req.user!;
    const spaceIds = listSpacesFor(rt, user).map((s) => s.id);
    const rows =
      user.role === 'admin'
        ? db
            .prepare(
              `SELECT a.*, u.display_name AS who, d.name AS device FROM activity a
               LEFT JOIN users u ON u.id = a.user_id LEFT JOIN devices d ON d.id = a.device_id
               ORDER BY a.id DESC LIMIT ?`,
            )
            .all(limit)
        : db
            .prepare(
              `SELECT a.*, u.display_name AS who, d.name AS device FROM activity a
               LEFT JOIN users u ON u.id = a.user_id LEFT JOIN devices d ON d.id = a.device_id
               WHERE a.user_id = ? OR a.space IN (${spaceIds.map(() => '?').join(',')})
               ORDER BY a.id DESC LIMIT ?`,
            )
            .all(user.id, ...spaceIds, limit);
    res.json({ activity: rows });
  });

  return r;
}
