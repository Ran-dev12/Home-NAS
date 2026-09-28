import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { Runtime } from '../runtime.ts';
import type { SessionUser } from '../auth.ts';
import { requireUser } from '../auth.ts';
import { HttpError, badRequest, conflict, notFound } from '../http.ts';
import { baseName, isWithinRel, joinRel, normalizeRel, parentRel, sanitizeName, toAbs, uniqueName, validateName } from '../paths.ts';
import { audienceOf, listSpacesFor, resolveSpace, type Space } from '../spaces.ts';
import { readDirEntries, statEntry, type EntryStat, type FileRow } from '../indexer.ts';
import { browserCanShowImage, canThumbImage, isMedia, kindOf } from '../kinds.ts';
import { commitFile, discard, receiveMultipart } from '../upload.ts';
import { sendThumb, sendUserFile, streamZip, type ZipItem } from '../serve.ts';
import { moveToTrash } from '../trash.ts';
import { logActivity } from '../activity.ts';

const GB = 1024 ** 3;

export function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' ? v : undefined;
}

export interface EntryJson {
  id: number | null;
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  kind: string;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb: boolean;
}

export function entryJson(rel: string, e: EntryStat, row?: FileRow): EntryJson {
  const kind = kindOf(e.name, e.isDir);
  return {
    id: row?.id ?? null,
    name: e.name,
    path: rel,
    isDir: e.isDir,
    size: e.size,
    mtime: Math.floor(e.mtimeMs),
    kind,
    takenAt: row?.taken_at ?? null,
    width: row?.width ?? null,
    height: row?.height ?? null,
    duration: row?.duration ?? null,
    thumb: kind === 'video' || (kind === 'image' && canThumbImage(e.name)),
  };
}

/** Update share links and phone-backup folders that pointed at a path that just moved. */
export function relinkPaths(rt: Runtime, fromSpace: string, fromRel: string, toSpace: string, toRel: string) {
  const db = rt.requireDb();
  const lo = fromRel + '/';
  const hi = fromRel + '0';
  db.prepare(
    `UPDATE share_links SET space = ?, path = ? || substr(path, ?) WHERE space = ? AND (path = ? OR (path >= ? AND path < ?))`,
  ).run(toSpace, toRel, fromRel.length + 1, fromSpace, fromRel, lo, hi);
  const home = /^u:(\d+)$/.exec(fromSpace);
  if (home && fromSpace === toSpace) {
    db.prepare(
      `UPDATE devices SET folder = ? || substr(folder, ?) WHERE user_id = ? AND (folder = ? OR (folder >= ? AND folder < ?))`,
    ).run(toRel, fromRel.length + 1, Number(home[1]), fromRel, lo, hi);
  }
}

/** True when two paths are the same file on disk (compares inode/file ID, exact as BigInt). */
function sameFile(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a, { bigint: true });
    const sb = fs.statSync(b, { bigint: true });
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

function notifyFs(rt: Runtime, space: string, dirRel: string) {
  const aud = audienceOf(rt, space);
  rt.events.emit('fs', { space, path: dirRel }, { userIds: aud.userIds, admins: aud.admins });
}

function existingDir(sp: Space, rel: string): string {
  const abs = toAbs(sp.root, rel);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    throw notFound('That folder no longer exists');
  }
  if (!st.isDirectory()) throw badRequest('That is a file, not a folder');
  return abs;
}

function pathsFromBody(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw badRequest('Select at least one item');
  if (v.length > 5000) throw badRequest('Too many items at once');
  return v.map((p) => {
    const rel = normalizeRel(p);
    if (rel === '/') throw badRequest('The top folder itself cannot be changed');
    return rel;
  });
}

export function fileRoutes(rt: Runtime): Router {
  const r = Router();
  r.use(['/api/fs', '/api/media', '/api/photos'], requireUser);

  const user = (req: Request): SessionUser => req.user!;

  r.get('/api/fs/list', (req, res) => {
    const sp = resolveSpace(rt, user(req), q(req, 'space'), 'read');
    const rel = normalizeRel(q(req, 'path'));
    const abs = existingDir(sp, rel);
    const entries = readDirEntries(abs);
    rt.indexer.reconcileDir(sp.id, rel, entries);
    const rows = new Map(
      (rt.requireDb().prepare('SELECT * FROM files WHERE space = ? AND parent = ?').all(sp.id, rel) as unknown as FileRow[]).map((r) => [r.name, r]),
    );
    res.json({
      space: { id: sp.id, name: sp.name, kind: sp.kind, access: sp.access },
      path: rel,
      entries: entries.map((e) => entryJson(joinRel(rel, e.name), e, rows.get(e.name))),
    });
  });

  r.get('/api/fs/info', (req, res) => {
    const sp = resolveSpace(rt, user(req), q(req, 'space'), 'read');
    const rel = normalizeRel(q(req, 'path'));
    const abs = toAbs(sp.root, rel);
    const e = statEntry(abs, rel === '/' ? sp.name : baseName(rel));
    if (!e) throw notFound();
    const row = rt.indexer.get(sp.id, rel);
    let contents: { files: number; folders: number; bytes: number } | null = null;
    if (e.isDir) {
      const lo = rel === '/' ? '/' : rel + '/';
      const hi = lo.slice(0, -1) + '0';
      const c = rt
        .requireDb()
        .prepare(
          `SELECT SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END) AS files, SUM(is_dir) AS folders, COALESCE(SUM(size), 0) AS bytes
           FROM files WHERE space = ? AND path >= ? AND path < ?`,
        )
        .get(sp.id, lo, hi) as { files: number | null; folders: number | null; bytes: number };
      contents = { files: c.files ?? 0, folders: c.folders ?? 0, bytes: c.bytes };
    }
    res.json({
      ...entryJson(rel, e, row),
      space: sp.id,
      camera: row?.camera ?? null,
      lat: row?.lat ?? null,
      lon: row?.lon ?? null,
      sha256: row?.sha256 ?? null,
      contents,
    });
  });

  r.get('/api/fs/download', (req, res, next) => {
    const sp = resolveSpace(rt, user(req), q(req, 'space'), 'read');
    const rel = normalizeRel(q(req, 'path'));
    const abs = toAbs(sp.root, rel);
    const st = fs.statSync(abs);
    const name = rel === '/' ? sp.name : baseName(rel);
    if (st.isDirectory()) return streamZip(res, name, [{ abs, name, isDir: true }]);
    sendUserFile(req, res, next, abs, name, q(req, 'inline') !== '1');
  });

  r.get('/api/fs/zip', (req, res) => {
    const sp = resolveSpace(rt, user(req), q(req, 'space'), 'read');
    let list: unknown;
    try {
      list = JSON.parse(q(req, 'paths') ?? '[]');
    } catch {
      throw badRequest('paths must be a JSON array');
    }
    const items: ZipItem[] = pathsFromBody(list).map((rel) => {
      const abs = toAbs(sp.root, rel);
      return { abs, name: baseName(rel), isDir: fs.statSync(abs).isDirectory() };
    });
    const folder = parentRel(pathsFromBody(list)[0]);
    streamZip(res, folder === '/' ? sp.name : baseName(folder), items);
  });

  r.post('/api/fs/mkdir', (req, res) => {
    const sp = resolveSpace(rt, user(req), req.body?.space, 'write');
    const parent = normalizeRel(req.body?.path);
    const name = validateName(req.body?.name);
    existingDir(sp, parent);
    const rel = joinRel(parent, name);
    const abs = toAbs(sp.root, rel);
    if (fs.existsSync(abs)) throw conflict(`"${name}" already exists here`);
    fs.mkdirSync(abs);
    rt.indexer.upsert(sp.id, rel, statEntry(abs, name)!);
    logActivity(rt, { userId: user(req).id, action: 'mkdir', space: sp.id, path: rel });
    notifyFs(rt, sp.id, parent);
    res.json({ path: rel });
  });

  r.post('/api/fs/rename', (req, res) => {
    const sp = resolveSpace(rt, user(req), req.body?.space, 'write');
    const rel = normalizeRel(req.body?.path);
    if (rel === '/') throw badRequest('The top folder cannot be renamed');
    const name = validateName(req.body?.name);
    const src = toAbs(sp.root, rel);
    if (!fs.existsSync(src)) throw notFound();
    const destRel = joinRel(parentRel(rel), name);
    const dest = toAbs(sp.root, destRel);
    // "photo.jpg" -> "Photo.jpg" is allowed where the filesystem sees them as the same file (NTFS, exFAT).
    // On a case-sensitive one (ext4 on a Pi) they can be two different files, and renaming would overwrite.
    if (fs.existsSync(dest) && !sameFile(src, dest)) throw conflict(`"${name}" already exists here`);
    fs.renameSync(src, dest);
    rt.indexer.moveTree(sp.id, rel, sp.id, destRel);
    relinkPaths(rt, sp.id, rel, sp.id, destRel);
    logActivity(rt, { userId: user(req).id, action: 'rename', space: sp.id, path: destRel, detail: baseName(rel) });
    notifyFs(rt, sp.id, parentRel(rel));
    res.json({ path: destRel });
  });

  r.post('/api/fs/move', async (req, res) => {
    const mode = req.body?.mode === 'copy' ? 'copy' : 'move';
    const src = resolveSpace(rt, user(req), req.body?.space, mode === 'move' ? 'write' : 'read');
    const dst = resolveSpace(rt, user(req), req.body?.toSpace ?? req.body?.space, 'write');
    const toRel = normalizeRel(req.body?.toPath);
    const toDirAbs = existingDir(dst, toRel);
    const done: string[] = [];
    for (const rel of pathsFromBody(req.body?.paths)) {
      if (src.id === dst.id && isWithinRel(toRel, rel)) throw badRequest(`Cannot put "${baseName(rel)}" inside itself`);
      if (mode === 'move' && src.id === dst.id && parentRel(rel) === toRel) continue;
      const srcAbs = toAbs(src.root, rel);
      if (!fs.existsSync(srcAbs)) throw notFound(`"${baseName(rel)}" no longer exists`);
      const name = uniqueName(toDirAbs, baseName(rel));
      const destRel = joinRel(toRel, name);
      const destAbs = path.join(toDirAbs, name);
      if (mode === 'move') {
        try {
          await fs.promises.rename(srcAbs, destAbs);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
          await fs.promises.cp(srcAbs, destAbs, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
          await fs.promises.rm(srcAbs, { recursive: true });
        }
        rt.indexer.moveTree(src.id, rel, dst.id, destRel);
        relinkPaths(rt, src.id, rel, dst.id, destRel);
      } else {
        await fs.promises.cp(srcAbs, destAbs, {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          filter: (p) => !fs.lstatSync(p).isSymbolicLink(),
        });
        const st = statEntry(destAbs, name)!;
        const srcRow = rt.indexer.get(src.id, rel);
        rt.indexer.upsert(dst.id, destRel, st, { sha256: !st.isDir ? srcRow?.sha256 ?? undefined : undefined, takenAt: srcRow?.taken_at });
        if (st.isDir) await rt.indexer.scanSubtree(dst.id, dst.root, destRel);
      }
      done.push(destRel);
    }
    if (done.length) {
      logActivity(rt, {
        userId: user(req).id,
        action: mode,
        space: dst.id,
        path: toRel,
        detail: `${done.length} item(s)${src.id !== dst.id ? ` from ${src.name}` : ''}`,
      });
    }
    notifyFs(rt, dst.id, toRel);
    if (src.id !== dst.id || mode === 'move') notifyFs(rt, src.id, '/');
    res.json({ paths: done });
  });

  r.post('/api/fs/delete', (req, res) => {
    const sp = resolveSpace(rt, user(req), req.body?.space, 'write');
    const rels = pathsFromBody(req.body?.paths);
    for (const rel of rels) moveToTrash(rt, sp.id, sp.root, rel, user(req).id);
    logActivity(rt, {
      userId: user(req).id,
      action: 'delete',
      space: sp.id,
      path: rels.length === 1 ? rels[0] : parentRel(rels[0]),
      detail: rels.length === 1 ? null : `${rels.length} items moved to trash`,
    });
    notifyFs(rt, sp.id, parentRel(rels[0]));
    res.json({ ok: true, count: rels.length });
  });

  r.post('/api/fs/upload', async (req, res) => {
    const sp = resolveSpace(rt, user(req), q(req, 'space'), 'write');
    const baseRel = normalizeRel(q(req, 'path'));
    existingDir(sp, baseRel);
    const mode = q(req, 'conflict') === 'overwrite' ? 'overwrite' : q(req, 'conflict') === 'skip' ? 'skip' : 'rename';
    const s = rt.settings();
    const rec = await receiveMultipart(req, {
      tmpDir: rt.paths.tmp,
      volumeRoot: rt.root,
      maxFileBytes: s.maxUploadGb * GB,
      minFreeBytes: s.minFreeGb * GB,
    });
    const results: { name: string; path?: string; status: 'stored' | 'skipped' | 'replaced' }[] = [];
    try {
      for (const f of rec.files) {
        // Folder uploads send "Holiday/Day 1" as relpath; every segment is made Windows-safe.
        let dirRel = baseRel;
        for (const seg of f.relpath.split(/[\\/]+/).filter(Boolean)) {
          dirRel = joinRel(dirRel, sanitizeName(seg, 'folder'));
          const dAbs = toAbs(sp.root, dirRel);
          if (!fs.existsSync(dAbs)) {
            fs.mkdirSync(dAbs);
            rt.indexer.upsert(sp.id, dirRel, statEntry(dAbs, baseName(dirRel))!);
          }
        }
        const dirAbs = toAbs(sp.root, dirRel);
        let name = sanitizeName(f.filename);
        let status: 'stored' | 'replaced' = 'stored';
        if (fs.existsSync(path.join(dirAbs, name))) {
          if (mode === 'skip') {
            discard([f]);
            results.push({ name, status: 'skipped' });
            continue;
          }
          if (mode === 'overwrite' && !fs.statSync(path.join(dirAbs, name)).isDirectory()) {
            moveToTrash(rt, sp.id, sp.root, joinRel(dirRel, name), user(req).id); // the old version stays recoverable
            status = 'replaced';
          } else {
            name = uniqueName(dirAbs, name);
          }
        }
        const lm = Number(rec.fields.lastModified);
        const rel = joinRel(dirRel, name);
        const abs = path.join(dirAbs, name);
        await commitFile(f, abs, lm > 0 ? new Date(lm) : undefined);
        rt.indexer.upsert(sp.id, rel, statEntry(abs, name)!, { sha256: f.sha256 });
        results.push({ name, path: rel, status });
      }
    } catch (err) {
      discard(rec.files);
      throw err;
    }
    const stored = results.filter((x) => x.status !== 'skipped');
    if (stored.length) {
      logActivity(rt, {
        userId: user(req).id,
        action: 'upload',
        space: sp.id,
        path: stored.length === 1 ? stored[0].path! : baseRel,
        detail: stored.length === 1 ? null : `${stored.length} files`,
      });
    }
    notifyFs(rt, sp.id, baseRel);
    res.json({ results });
  });

  r.get('/api/fs/search', (req, res) => {
    const term = (q(req, 'q') ?? '').trim();
    if (term.length < 2) return res.json({ results: [] });
    const spaces = listSpacesFor(rt, user(req));
    const names = new Map(spaces.map((s) => [s.id, s.name]));
    const marks = spaces.map(() => '?').join(',');
    const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const rows = rt
      .requireDb()
      .prepare(`SELECT * FROM files WHERE space IN (${marks}) AND name LIKE ? ESCAPE '\\' ORDER BY is_dir DESC, mtime DESC LIMIT 200`)
      .all(...spaces.map((s) => s.id), like) as unknown as FileRow[];
    res.json({
      results: rows.map((row) => ({
        ...entryJson(row.path, { name: row.name, isDir: !!row.is_dir, size: row.size, mtimeMs: row.mtime }, row),
        space: row.space,
        spaceName: names.get(row.space),
      })),
    });
  });

  // ---- Photo timeline ------------------------------------------------------------------------------

  r.get('/api/photos', (req, res) => {
    const spaces = listSpacesFor(rt, user(req));
    const only = q(req, 'space');
    const ids = only && only !== 'all' ? spaces.filter((s) => s.id === only).map((s) => s.id) : spaces.map((s) => s.id);
    if (!ids.length) return res.json({ items: [], next: null });
    const limit = Math.min(Math.max(Number(q(req, 'limit')) || 150, 1), 500);
    const [cts, cid] = (q(req, 'cursor') ?? '').split(':').map(Number);
    const hasCursor = Number.isFinite(cts) && Number.isFinite(cid) && q(req, 'cursor');
    const marks = ids.map(() => '?').join(',');
    const rows = rt
      .requireDb()
      .prepare(
        `SELECT id, space, path, name, kind, ts, taken_at, width, height, duration, size, mtime, media_state
         FROM files
         WHERE space IN (${marks}) AND kind IN ('image', 'video')
           AND lower(name) NOT LIKE '%.svg' AND lower(name) NOT LIKE '%.ico'
           ${hasCursor ? 'AND (ts < ? OR (ts = ? AND id < ?))' : ''}
         ORDER BY ts DESC, id DESC LIMIT ?`,
      )
      .all(...ids, ...(hasCursor ? [cts, cts, cid] : []), limit) as unknown as FileRow[];
    const last = rows[rows.length - 1];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        space: row.space,
        path: row.path,
        name: row.name,
        kind: row.kind,
        ts: row.ts,
        takenAt: row.taken_at,
        width: row.width,
        height: row.height,
        duration: row.duration,
        size: row.size,
        mtime: row.mtime,
      })),
      next: rows.length === limit && last ? `${last.ts}:${last.id}` : null,
    });
  });

  // ---- Media by index id (thumbnails, previews, originals) -------------------------------------------

  function mediaRow(req: Request): { row: FileRow; abs: string } {
    const id = Number(req.params.id);
    const row = Number.isInteger(id) ? rt.indexer.getById(id) : undefined;
    if (!row || row.is_dir) throw notFound();
    const sp = resolveSpace(rt, user(req), row.space, 'read');
    const abs = toAbs(sp.root, row.path);
    if (!fs.existsSync(abs)) {
      rt.indexer.removeTree(row.space, row.path);
      throw notFound('That file no longer exists');
    }
    return { row, abs };
  }

  r.get('/api/media/:id', (req, res) => {
    const { row } = mediaRow(req);
    res.json({
      id: row.id,
      space: row.space,
      path: row.path,
      name: row.name,
      kind: row.kind,
      size: row.size,
      mtime: row.mtime,
      takenAt: row.taken_at,
      width: row.width,
      height: row.height,
      duration: row.duration,
      lat: row.lat,
      lon: row.lon,
      camera: row.camera,
    });
  });

  r.get('/api/media/:id/thumb', async (req, res, next) => {
    const { row } = mediaRow(req);
    if (!isMedia(row.kind)) throw notFound();
    const file = await rt.media.thumbFor(row);
    if (!file) throw new HttpError(404, 'no_thumbnail', 'No thumbnail for this file');
    sendThumb(res, next, file);
  });

  r.get('/api/media/:id/preview', async (req, res, next) => {
    const { row, abs } = mediaRow(req);
    if (row.kind === 'video' || row.kind === 'audio' || browserCanShowImage(row.name)) {
      return sendUserFile(req, res, next, abs, row.name, false);
    }
    if (row.kind !== 'image' || !canThumbImage(row.name)) throw notFound();
    const file = await rt.media.previewFor(row, abs);
    if (!file) throw notFound();
    sendThumb(res, next, file);
  });

  r.get('/api/media/:id/file', (req, res, next) => {
    const { row, abs } = mediaRow(req);
    sendUserFile(req, res, next, abs, row.name, q(req, 'dl') === '1');
  });

  return r;
}
