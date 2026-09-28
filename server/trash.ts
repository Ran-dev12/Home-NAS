import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Runtime } from './runtime.ts';
import type { SessionUser } from './auth.ts';
import { listSpacesFor, spaceRoot } from './spaces.ts';
import { baseName, joinRel, parentRel, toAbs, uniqueName } from './paths.ts';
import { notFound } from './http.ts';

export interface TrashRow {
  id: string;
  space: string;
  path: string;
  name: string;
  is_dir: number;
  size: number;
  deleted_by: number | null;
  deleted_at: string;
}

function treeSize(rt: Runtime, space: string, rel: string, isDir: boolean, abs: string): number {
  if (!isDir) {
    try {
      return fs.statSync(abs).size;
    } catch {
      return 0;
    }
  }
  const lo = rel + '/';
  const hi = rel + '0';
  const r = rt.requireDb().prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE space = ? AND path >= ? AND path < ?').get(space, lo, hi) as { n: number };
  return r.n;
}

/** Deleting never destroys data: the item moves into .homenas/trash on the same drive (a rename). */
export function moveToTrash(rt: Runtime, space: string, root: string, rel: string, userId: number): TrashRow {
  const abs = toAbs(root, rel);
  const st = fs.statSync(abs);
  const id = crypto.randomUUID();
  const holder = path.join(rt.paths.trash, id);
  fs.mkdirSync(holder, { recursive: true });
  const row: TrashRow = {
    id,
    space,
    path: rel,
    name: baseName(rel),
    is_dir: st.isDirectory() ? 1 : 0,
    size: treeSize(rt, space, rel, st.isDirectory(), abs),
    deleted_by: userId,
    deleted_at: new Date().toISOString(),
  };
  fs.renameSync(abs, path.join(holder, row.name));
  rt.requireDb()
    .prepare('INSERT INTO trash (id, space, path, name, is_dir, size, deleted_by, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.space, row.path, row.name, row.is_dir, row.size, row.deleted_by, row.deleted_at);
  rt.indexer.removeTree(space, rel);
  return row;
}

/** Trash items this user may see: their home, plus shared folders they can write to. */
export function visibleTrash(rt: Runtime, user: SessionUser): TrashRow[] {
  const writable = listSpacesFor(rt, user)
    .filter((s) => s.access === 'write')
    .map((s) => s.id);
  if (!writable.length) return [];
  const marks = writable.map(() => '?').join(',');
  return rt
    .requireDb()
    .prepare(`SELECT * FROM trash WHERE space IN (${marks}) ORDER BY deleted_at DESC LIMIT 2000`)
    .all(...writable) as unknown as TrashRow[];
}

export function getTrashFor(rt: Runtime, user: SessionUser, id: string): TrashRow {
  const row = visibleTrash(rt, user).find((r) => r.id === id);
  if (!row) throw notFound('That item is no longer in the trash');
  return row;
}

/** Put an item back where it was; recreates missing parent folders, renames on a name clash. */
export function restoreFromTrash(rt: Runtime, row: TrashRow): { space: string; path: string } {
  const root = spaceRoot(rt, row.space);
  if (!root) throw notFound('The folder this came from no longer exists');
  const src = path.join(rt.paths.trash, row.id, row.name);
  if (!fs.existsSync(src)) {
    rt.requireDb().prepare('DELETE FROM trash WHERE id = ?').run(row.id);
    throw notFound('The trashed file is missing from the drive');
  }
  const parent = parentRel(row.path);
  const parentAbs = toAbs(root, parent);
  fs.mkdirSync(parentAbs, { recursive: true });
  const name = uniqueName(parentAbs, row.name);
  const destRel = joinRel(parent, name);
  fs.renameSync(src, toAbs(root, destRel));
  fs.rmSync(path.join(rt.paths.trash, row.id), { recursive: true, force: true });
  rt.requireDb().prepare('DELETE FROM trash WHERE id = ?').run(row.id);
  return { space: row.space, path: destRel };
}

export async function purgeTrash(rt: Runtime, row: TrashRow) {
  await fs.promises.rm(path.join(rt.paths.trash, row.id), { recursive: true, force: true, maxRetries: 3 });
  rt.requireDb().prepare('DELETE FROM trash WHERE id = ?').run(row.id);
}

export async function purgeExpired(rt: Runtime): Promise<number> {
  const days = rt.settings().trashDays;
  if (!days || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = rt.requireDb().prepare('SELECT * FROM trash WHERE deleted_at < ?').all(cutoff) as unknown as TrashRow[];
  for (const r of rows) await purgeTrash(rt, r);
  return rows.length;
}
