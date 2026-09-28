import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Runtime } from '../runtime.ts';
import { FailureLimiter, clientIp, hashPassword, parseCookies, randomToken, requireUser, verifyPassword } from '../auth.ts';
import { HttpError, badRequest, notFound } from '../http.ts';
import { baseName, joinRel, normalizeRel, toAbs } from '../paths.ts';
import { resolveSpace, spaceRoot, listSpacesFor } from '../spaces.ts';
import { readDirEntries, statEntry } from '../indexer.ts';
import { sendThumb, sendUserFile, streamZip } from '../serve.ts';
import { entryJson, q } from './files.ts';
import { baseUrlFor } from './devices.ts';
import { logActivity } from '../activity.ts';
import { browserCanShowImage, isMedia } from '../kinds.ts';

interface LinkRow {
  id: number;
  token: string;
  space: string;
  path: string;
  is_dir: number;
  name: string;
  created_by: number;
  created_at: string;
  expires_at: string | null;
  password_hash: string | null;
  views: number;
  downloads: number;
  revoked: number;
}

const UNLOCK_HOURS = 12;

export function shareRoutes(rt: Runtime): Router {
  const r = Router();
  const unlockLimiter = new FailureLimiter(10, 15 * 60_000);

  function linkJson(req: Request, l: LinkRow, spaceName?: string) {
    return {
      id: l.id,
      url: `${baseUrlFor(rt, req).baseUrl}/s/${l.token}`,
      space: l.space,
      spaceName,
      path: l.path,
      name: l.name,
      isDir: !!l.is_dir,
      createdAt: l.created_at,
      expiresAt: l.expires_at,
      hasPassword: !!l.password_hash,
      views: l.views,
      downloads: l.downloads,
      active: !l.revoked && (!l.expires_at || Date.parse(l.expires_at) > Date.now()),
    };
  }

  // ---- Managing links --------------------------------------------------------------------------------

  r.get('/api/shares', requireUser, (req, res) => {
    const names = new Map(listSpacesFor(rt, req.user!).map((s) => [s.id, s.name]));
    const rows = rt
      .requireDb()
      .prepare('SELECT * FROM share_links WHERE created_by = ? AND revoked = 0 ORDER BY created_at DESC')
      .all(req.user!.id) as unknown as LinkRow[];
    res.json({ links: rows.map((l) => linkJson(req, l, names.get(l.space))) });
  });

  r.post('/api/shares', requireUser, async (req, res) => {
    // Sharing outside the NAS needs write access: a read-only member should not publish a family folder.
    const sp = resolveSpace(rt, req.user!, req.body?.space, 'write');
    const rel = normalizeRel(req.body?.path);
    const abs = toAbs(sp.root, rel);
    const e = statEntry(abs, rel === '/' ? sp.name : baseName(rel));
    if (!e) throw notFound();
    const days = req.body?.expiresDays === null || req.body?.expiresDays === undefined ? null : Number(req.body.expiresDays);
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) throw badRequest('Expiry must be between 1 and 3650 days');
    const pw = typeof req.body?.password === 'string' && req.body.password ? String(req.body.password) : null;
    if (pw && pw.length < 4) throw badRequest('Link password must be at least 4 characters');
    const token = randomToken(16);
    const now = new Date();
    const info = rt
      .requireDb()
      .prepare(
        `INSERT INTO share_links (token, space, path, is_dir, name, created_by, created_at, expires_at, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token,
        sp.id,
        rel,
        e.isDir ? 1 : 0,
        e.name,
        req.user!.id,
        now.toISOString(),
        days ? new Date(now.getTime() + days * 86400_000).toISOString() : null,
        pw ? await hashPassword(pw) : null,
      );
    logActivity(rt, { userId: req.user!.id, action: 'share', space: sp.id, path: rel, detail: days ? `expires in ${days} days` : null });
    const row = rt.requireDb().prepare('SELECT * FROM share_links WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as LinkRow;
    res.json({ link: linkJson(req, row, sp.name) });
  });

  r.delete('/api/shares/:id', requireUser, (req, res) => {
    const db = rt.requireDb();
    const row = db.prepare('SELECT * FROM share_links WHERE id = ?').get(Number(req.params.id)) as unknown as LinkRow | undefined;
    if (!row || (row.created_by !== req.user!.id && req.user!.role !== 'admin')) throw notFound('Link not found');
    db.prepare('UPDATE share_links SET revoked = 1 WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // ---- Public side (no account) ---------------------------------------------------------------------

  function cookieName(l: LinkRow) {
    return `hn_sl_${l.id}`;
  }

  function isUnlocked(req: Request, l: LinkRow): boolean {
    if (!l.password_hash) return true;
    const v = parseCookies(req.headers.cookie)[cookieName(l)];
    if (!v) return false;
    const [exp, sig] = v.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = rt.hmac(`share:${l.id}:${l.password_hash}:${exp}`);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  function loadLink(req: Request): LinkRow {
    const token = String(req.params.token ?? '');
    const l = /^[A-Za-z0-9_-]{10,64}$/.test(token)
      ? (rt.requireDb().prepare('SELECT * FROM share_links WHERE token = ?').get(token) as unknown as LinkRow | undefined)
      : undefined;
    if (!l || l.revoked) throw notFound('This link does not exist or has been turned off');
    if (l.expires_at && Date.parse(l.expires_at) < Date.now()) throw new HttpError(410, 'expired', 'This link has expired');
    return l;
  }

  /** Resolve a path inside a shared item; can never climb out of it. */
  function target(req: Request, l: LinkRow, needUnlock = true): { abs: string; rel: string; spaceRel: string } {
    if (needUnlock && !isUnlocked(req, l)) throw new HttpError(401, 'password_required', 'This link is password protected');
    const root = spaceRoot(rt, l.space);
    if (!root) throw notFound('The shared folder no longer exists');
    const linkAbs = toAbs(root, l.path);
    const sub = l.is_dir ? normalizeRel(q(req, 'path')) : '/';
    const abs = sub === '/' ? linkAbs : toAbs(linkAbs, sub);
    if (!fs.existsSync(abs)) throw notFound('The shared item is no longer available');
    const spaceRel = sub === '/' ? l.path : l.path === '/' ? sub : l.path + sub;
    return { abs, rel: sub, spaceRel };
  }

  r.get('/api/public/share/:token', (req, res) => {
    const l = loadLink(req);
    const serverName = rt.settings().serverName;
    const meta = { name: l.name, isDir: !!l.is_dir, expiresAt: l.expires_at, serverName };
    if (!isUnlocked(req, l)) return res.json({ ...meta, needsPassword: true });
    const t = target(req, l);
    if (t.rel === '/') rt.requireDb().prepare('UPDATE share_links SET views = views + 1 WHERE id = ?').run(l.id);
    if (!l.is_dir) {
      const e = statEntry(t.abs, l.name)!;
      return res.json({ ...meta, needsPassword: false, file: entryJson('/', e) });
    }
    const entries = readDirEntries(t.abs)
      .map((e) => entryJson(joinRel(t.rel, e.name), e))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    res.json({ ...meta, needsPassword: false, path: t.rel, entries });
  });

  r.post('/api/public/share/:token/unlock', async (req, res: Response) => {
    const l = loadLink(req);
    const key = `${clientIp(req)}|${l.id}`;
    unlockLimiter.check(key);
    if (!l.password_hash || !(await verifyPassword(String(req.body?.password ?? ''), l.password_hash))) {
      unlockLimiter.fail(key);
      throw new HttpError(401, 'bad_password', 'Wrong password');
    }
    const exp = Date.now() + UNLOCK_HOURS * 3600_000;
    res.cookie(cookieName(l), `${exp}.${rt.hmac(`share:${l.id}:${l.password_hash}:${exp}`)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      maxAge: UNLOCK_HOURS * 3600_000,
    });
    res.json({ ok: true });
  });

  r.get('/api/public/share/:token/file', (req, res, next) => {
    const l = loadLink(req);
    const t = target(req, l);
    if (fs.statSync(t.abs).isDirectory()) {
      rt.requireDb().prepare('UPDATE share_links SET downloads = downloads + 1 WHERE id = ?').run(l.id);
      return streamZip(res, t.rel === '/' ? l.name : baseName(t.rel), [{ abs: t.abs, name: t.rel === '/' ? l.name : baseName(t.rel), isDir: true }]);
    }
    const dl = q(req, 'dl') === '1';
    if (dl) rt.requireDb().prepare('UPDATE share_links SET downloads = downloads + 1 WHERE id = ?').run(l.id);
    sendUserFile(req, res, next, t.abs, t.rel === '/' ? l.name : baseName(t.rel), dl);
  });

  r.get('/api/public/share/:token/thumb', async (req, res, next) => {
    const l = loadLink(req);
    const t = target(req, l);
    const e = statEntry(t.abs, baseName(t.spaceRel) || l.name);
    if (!e || e.isDir) throw notFound();
    const row = rt.indexer.upsert(l.space, t.spaceRel, e);
    if (!isMedia(row.kind)) throw notFound();
    const file = await rt.media.thumbFor(row);
    if (!file) throw notFound();
    sendThumb(res, next, file);
  });

  r.get('/api/public/share/:token/preview', async (req, res, next) => {
    const l = loadLink(req);
    const t = target(req, l);
    const e = statEntry(t.abs, baseName(t.spaceRel) || l.name);
    if (!e || e.isDir) throw notFound();
    const row = rt.indexer.upsert(l.space, t.spaceRel, e);
    if (row.kind !== 'image' || browserCanShowImage(row.name)) return sendUserFile(req, res, next, t.abs, row.name, false);
    const file = await rt.media.previewFor(row, t.abs);
    if (!file) throw notFound();
    sendThumb(res, next, file);
  });

  return r;
}
