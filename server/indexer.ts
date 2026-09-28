import fs from 'node:fs';
import path from 'node:path';
import type { Runtime } from './runtime.ts';
import { tx } from './db.ts';
import { kindOf, isMedia } from './kinds.ts';
import { isHiddenName, joinRel, parentRel } from './paths.ts';
import { allSpaces, audienceOf } from './spaces.ts';

export interface FileRow {
  id: number;
  space: string;
  path: string;
  parent: string;
  name: string;
  is_dir: number;
  size: number;
  mtime: number;
  kind: string;
  sha256: string | null;
  taken_at: string | null;
  ts: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  lat: number | null;
  lon: number | null;
  camera: string | null;
  media_state: string;
  seen: number;
}

export interface EntryStat {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export interface UpsertExtra {
  sha256?: string;
  takenAt?: string | null;
  seen?: number;
}

/** [lo, hi) bounds that select every path strictly inside `rel` under BINARY collation. */
function subtreeRange(rel: string): [string, string] {
  const prefix = rel === '/' ? '/' : rel + '/';
  return [prefix, prefix.slice(0, -1) + '0']; // '0' is the character right after '/'
}

export function statEntry(abs: string, name: string): EntryStat | null {
  try {
    const st = fs.statSync(abs);
    return { name, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Visible children of a directory: skips OS junk, symlinks and junctions (never followed). */
export function readDirEntries(abs: string): EntryStat[] {
  const out: EntryStat[] = [];
  for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
    if (isHiddenName(d.name) || d.isSymbolicLink()) continue;
    const e = statEntry(path.join(abs, d.name), d.name);
    if (e) out.push(e);
  }
  return out;
}

export class Indexer {
  rt: Runtime;
  scanning = false;
  lastScan: { at: string; files: number; ms: number; errors: number } | null = null;
  progress = { files: 0 };
  private stopped = true;
  private timer?: NodeJS.Timeout;

  constructor(rt: Runtime) {
    this.rt = rt;
  }

  private get db() {
    return this.rt.requireDb();
  }

  get(space: string, rel: string): FileRow | undefined {
    return this.db.prepare('SELECT * FROM files WHERE space = ? AND path = ?').get(space, rel) as FileRow | undefined;
  }

  getById(id: number): FileRow | undefined {
    return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
  }

  upsert(space: string, rel: string, e: EntryStat, extra: UpsertExtra = {}): FileRow {
    const db = this.db;
    const existing = this.get(space, rel);
    const kind = kindOf(e.name, e.isDir);
    const mtime = Math.floor(e.mtimeMs);
    const size = e.isDir ? 0 : e.size;
    const isDir = e.isDir ? 1 : 0;
    // Rows written outside a scan get "now", which is newer than any scan already running, so that scan's
    // stale-row purge cannot delete a file that was uploaded into a folder the scan had already passed.
    const seen = extra.seen ?? Date.now();
    if (existing && existing.size === size && existing.mtime === mtime && existing.is_dir === isDir && existing.name === e.name && !extra.sha256) {
      if (extra.seen && existing.seen !== extra.seen) db.prepare('UPDATE files SET seen = ? WHERE id = ?').run(extra.seen, existing.id);
      return existing;
    }
    const takenAt = extra.takenAt ?? null;
    const ts = takenAt ? Date.parse(takenAt) : mtime;
    const state = isMedia(kind) ? 'pending' : 'na';
    if (existing) {
      db.prepare(
        `UPDATE files SET name = ?, is_dir = ?, size = ?, mtime = ?, kind = ?, sha256 = ?, taken_at = ?, ts = ?,
           width = NULL, height = NULL, duration = NULL, lat = NULL, lon = NULL, camera = NULL, media_state = ?, seen = ?
         WHERE id = ?`,
      ).run(e.name, isDir, size, mtime, kind, extra.sha256 ?? null, takenAt, ts, state, seen, existing.id);
    } else {
      db.prepare(
        `INSERT INTO files (space, path, parent, name, is_dir, size, mtime, kind, sha256, taken_at, ts, media_state, seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(space, rel, parentRel(rel), e.name, isDir, size, mtime, kind, extra.sha256 ?? null, takenAt, ts, state, seen);
    }
    if (state === 'pending') this.rt.media.kick();
    return this.get(space, rel)!;
  }

  removeTree(space: string, rel: string) {
    const [lo, hi] = subtreeRange(rel);
    this.db.prepare('DELETE FROM files WHERE space = ? AND (path = ? OR (path >= ? AND path < ?))').run(space, rel, lo, hi);
  }

  /** Re-key rows after a move/rename so hashes, dates and thumbnails survive. */
  moveTree(fromSpace: string, fromRel: string, toSpace: string, toRel: string) {
    const db = this.db;
    tx(db, () => {
      this.removeTree(toSpace, toRel);
      const [lo, hi] = subtreeRange(fromRel);
      const rows = db
        .prepare('SELECT id, path FROM files WHERE space = ? AND (path = ? OR (path >= ? AND path < ?))')
        .all(fromSpace, fromRel, lo, hi) as { id: number; path: string }[];
      const upd = db.prepare('UPDATE files SET space = ?, path = ?, parent = ?, name = ?, seen = ? WHERE id = ?');
      const now = Date.now();
      for (const r of rows) {
        const next = toRel + r.path.slice(fromRel.length);
        upd.run(toSpace, next, parentRel(next), next.slice(next.lastIndexOf('/') + 1), now, r.id);
      }
    });
  }

  /** Bring the rows for one directory's children in line with what is on disk right now. */
  reconcileDir(space: string, rel: string, entries: EntryStat[]) {
    const db = this.db;
    tx(db, () => {
      const existing = db.prepare('SELECT name, path FROM files WHERE space = ? AND parent = ?').all(space, rel) as { name: string; path: string }[];
      const present = new Set(entries.map((e) => e.name));
      for (const row of existing) if (!present.has(row.name)) this.removeTree(space, row.path);
      for (const e of entries) this.upsert(space, joinRel(rel, e.name), e);
    });
  }

  start() {
    this.stopped = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loop(), 3000);
    this.watch();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.flushTimer);
    this.dirty.clear();
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }

  // ---- Live watching: files copied onto the drive with Explorer show up within seconds -----------------

  private watchers: fs.FSWatcher[] = [];
  private dirty = new Map<string, { space: string; rel: string; abs: string }>();
  private flushTimer?: NodeJS.Timeout;

  private watch() {
    const p = this.rt.paths;
    for (const [base, kind] of [
      [p.users, 'u'],
      [p.shared, 's'],
    ] as const) {
      try {
        // Watch the long-name form of the path. libuv aborts the whole process if the watched path contains
        // an 8.3 short name (like C:\Users\JOHNSM~1) because Windows reports events under the long name.
        const real = fs.realpathSync.native(base);
        const w = fs.watch(real, { recursive: true }, (_event, filename) => {
          if (filename) this.onChange(kind, base, filename.toString());
        });
        w.on('error', () => w.close()); // drive unplugged; the volume monitor handles the rest
        this.watchers.push(w);
      } catch (err) {
        this.rt.log(`Live file watching unavailable (${(err as Error).message}); relying on periodic scans`);
      }
    }
  }

  private onChange(kind: 'u' | 's', base: string, filename: string) {
    const [top, ...rest] = filename.split(/[\\/]+/).filter(Boolean);
    if (!top || !rest.length || rest.some(isHiddenName)) return;
    const db = this.rt.db;
    if (!db) return;
    const row =
      kind === 'u'
        ? (db.prepare('SELECT id FROM users WHERE username = ?').get(top) as { id: number } | undefined)
        : (db.prepare('SELECT id FROM spaces WHERE folder = ?').get(top) as { id: number } | undefined);
    if (!row) return;
    const space = `${kind}:${row.id}`;
    const rootAbs = path.join(base, top);
    const rel = '/' + rest.join('/');
    const dirs = [parentRel(rel)];
    try {
      if (fs.statSync(path.join(rootAbs, ...rest)).isDirectory()) dirs.push(rel);
    } catch {
      /* deleted: reconciling the parent removes it */
    }
    for (const d of dirs) this.dirty.set(`${space}|${d}`, { space, rel: d, abs: path.join(rootAbs, '.' + d) });
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 1500); // wait for a copy burst to settle
  }

  private flush() {
    const batch = [...this.dirty.values()];
    this.dirty.clear();
    if (this.rt.state !== 'online' || !this.rt.db) return;
    const touched = new Map<string, string>();
    for (const d of batch) {
      try {
        this.reconcileDir(d.space, d.rel, readDirEntries(d.abs));
        touched.set(d.space, d.rel);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') this.removeTree(d.space, d.rel);
      }
    }
    for (const [space, rel] of touched) {
      const aud = audienceOf(this.rt, space);
      this.rt.events.emit('fs', { space, path: rel }, { userIds: aud.userIds, admins: aud.admins });
    }
  }

  private async loop() {
    if (this.stopped) return;
    await this.scanAll().catch((err) => this.rt.log('Scan failed:', err));
    if (this.stopped || this.rt.state !== 'online') return;
    const minutes = Math.max(5, this.rt.settings().scanMinutes);
    this.timer = setTimeout(() => this.loop(), minutes * 60_000);
  }

  /** Walk every space and reconcile the whole index. Safe to call while the app is in use. */
  async scanAll(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    this.progress = { files: 0 };
    let errors = 0;
    try {
      for (const sp of allSpaces(this.rt)) {
        if (this.stopped && this.rt.background) break;
        errors += await this.scanSubtree(sp.id, sp.root, '/');
      }
      this.lastScan = { at: new Date().toISOString(), files: this.progress.files, ms: Date.now() - started, errors };
      this.rt.events.emit('index', { scanning: false, ...this.lastScan }, { admins: true });
      this.rt.media.kick();
    } finally {
      this.scanning = false;
    }
  }

  /** Walk one subtree; returns the number of unreadable directories. Stale rows are only purged if every directory was readable. */
  async scanSubtree(space: string, spaceRootAbs: string, rel: string): Promise<number> {
    if (!fs.existsSync(spaceRootAbs)) return 0;
    const seq = Date.now();
    const stack = [rel];
    let errors = 0;
    while (stack.length) {
      if (this.rt.state !== 'online') throw new Error('Storage went offline during scan');
      const dirRel = stack.pop()!;
      const dirAbs = path.join(spaceRootAbs, '.' + dirRel);
      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(dirAbs, { withFileTypes: true });
      } catch {
        errors++;
        continue;
      }
      const stats: EntryStat[] = [];
      await Promise.all(
        dirents
          .filter((d) => !isHiddenName(d.name) && !d.isSymbolicLink())
          .map(async (d) => {
            try {
              const st = await fs.promises.stat(path.join(dirAbs, d.name));
              stats.push({ name: d.name, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs });
            } catch {
              /* vanished mid-scan */
            }
          }),
      );
      tx(this.db, () => {
        for (const e of stats) this.upsert(space, joinRel(dirRel, e.name), e, { seen: seq });
      });
      this.progress.files += stats.length;
      for (const e of stats) if (e.isDir) stack.push(joinRel(dirRel, e.name));
      // Let requests through between directories on big trees.
      await new Promise((r) => setImmediate(r));
    }
    if (errors === 0) {
      const [lo, hi] = subtreeRange(rel);
      this.db
        .prepare('DELETE FROM files WHERE space = ? AND seen < ? AND (path >= ? AND path < ?)')
        .run(space, seq, lo, hi);
    }
    return errors;
  }
}
