import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import exifr from 'exifr';
import decodeHeic from 'heic-decode';
import type { Runtime } from './runtime.ts';
import type { FileRow } from './indexer.ts';
import { canThumbImage, isHeic } from './kinds.ts';
import { spaceRoot } from './spaces.ts';

// Never keep file handles open between jobs: on Windows an open handle blocks rename/delete (EBUSY).
sharp.cache(false);

/**
 * libvips opens files with the legacy Windows API, which fails on paths over 260 characters (deep folders,
 * long names). Node handles long paths, so Node does all file I/O and sharp only ever sees buffers.
 */
async function sharpFrom(abs: string): Promise<Sharp> {
  return sharp(await fs.promises.readFile(abs), { failOn: 'none' });
}

/**
 * exifr's own file reader calls FileHandle.stat(path), which Node 26 rejects, and then never closes the
 * handle; Node 26 treats a garbage-collected FileHandle as a fatal error. So Node reads the file and exifr
 * only ever sees a buffer. Metadata sits near the start, so very large files are read only in part.
 */
export const EXIF_READ_MAX = 64 * 1024 * 1024;

/** The first `max` bytes of a file (all of it if smaller). The handle is always closed. */
export async function readHead(abs: string, max: number): Promise<Buffer> {
  const fh = await fs.promises.open(abs, 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, max));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * iOS marks screenshots with the comment "Screenshot": in EXIF (stored as "ASCII\0\0\0Screenshot") or in
 * XMP. exifr does not read the XMP form in PNGs, so look for the marker in the file's metadata directly.
 */
export async function isScreenshot(abs: string): Promise<boolean> {
  const head = (await readHead(abs, 256 * 1024)).toString('latin1');
  return head.includes('ASCII\0\0\0Screenshot') || /UserComment[\s\S]{0,200}?Screenshot/.test(head);
}

const THUMB_PX = 480;
const PREVIEW_PX = 2048;

export async function hashFile(abs: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(abs), h);
  return h.digest('hex');
}

interface MediaMeta {
  takenAt: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  lat: number | null;
  lon: number | null;
  camera: string | null;
}

const EMPTY_META: MediaMeta = { takenAt: null, width: null, height: null, duration: null, lat: null, lon: null, camera: null };

/** "+05:30" / "+0530" / "Z" -> minutes east of UTC. */
function offsetMinutes(off: unknown): number | null {
  if (typeof off !== 'string') return null;
  if (off === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(off.trim());
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Build an ISO timestamp from wall-clock fields plus an optional offset (EXIF stores no zone by itself). */
function wallClockToIso(d: Date, offMin: number | null): string {
  if (offMin === null) return d.toISOString(); // exifr already read it as server-local time
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - offMin * 60_000;
  return new Date(utc).toISOString();
}

function dmsToDeg(v: unknown, ref: unknown): number | null {
  if (typeof v === 'number') return v;
  if (!Array.isArray(v) || v.length < 3) return null;
  const deg = Number(v[0]) + Number(v[1]) / 60 + Number(v[2]) / 3600;
  if (!Number.isFinite(deg)) return null;
  return ref === 'S' || ref === 'W' ? -deg : deg;
}

async function imageMeta(abs: string, name: string): Promise<MediaMeta> {
  const meta: MediaMeta = { ...EMPTY_META };
  try {
    const x = await exifr.parse(await readHead(abs, EXIF_READ_MAX), { tiff: true, ifd0: true, exif: true, gps: true, translateValues: false, mergeOutput: true } as never);
    if (x) {
      const dt: Date | undefined = x.DateTimeOriginal ?? x.CreateDate ?? x.DateTimeDigitized;
      if (dt instanceof Date && !isNaN(dt.getTime())) meta.takenAt = wallClockToIso(dt, offsetMinutes(x.OffsetTimeOriginal ?? x.OffsetTime));
      const lat = x.latitude ?? dmsToDeg(x.GPSLatitude, x.GPSLatitudeRef);
      const lon = x.longitude ?? dmsToDeg(x.GPSLongitude, x.GPSLongitudeRef);
      if (typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0)) {
        meta.lat = lat;
        meta.lon = lon;
      }
      const model = typeof x.Model === 'string' ? x.Model.trim() : '';
      const make = typeof x.Make === 'string' ? x.Make.trim() : '';
      meta.camera = model ? (make && !model.toLowerCase().startsWith(make.toLowerCase()) && make !== 'Apple' ? `${make} ${model}` : model) : make || null;
      let w = Number(x.ExifImageWidth ?? x.ImageWidth) || null;
      let h = Number(x.ExifImageHeight ?? x.ImageHeight) || null;
      if (w && h && [5, 6, 7, 8].includes(Number(x.Orientation))) [w, h] = [h, w];
      meta.width = w;
      meta.height = h;
    }
  } catch {
    /* no EXIF is normal for screenshots, PNGs, downloads */
  }
  if ((!meta.width || !meta.height) && !isHeic(name)) {
    try {
      const m = await (await sharpFrom(abs)).metadata();
      const rotated = (m.orientation ?? 1) >= 5;
      meta.width = (rotated ? m.height : m.width) ?? null;
      meta.height = (rotated ? m.width : m.height) ?? null;
    } catch {
      /* not decodable */
    }
  }
  return meta;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.stderr.on('data', (b: Buffer) => (err += b.toString().slice(0, 2000)));
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim()}`));
    });
  });
}

/** ISO 6709 "+12.9716+077.5946+920.000/" -> [lat, lon] */
function parseIso6709(s: unknown): [number, number] | null {
  if (typeof s !== 'string') return null;
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function videoMeta(abs: string, ffprobe: string | null): Promise<MediaMeta> {
  const meta: MediaMeta = { ...EMPTY_META };
  if (!ffprobe) return meta;
  try {
    const raw = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs], 30_000);
    const j = JSON.parse(raw.toString());
    const v = (j.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'video');
    const tags = { ...(j.format?.tags ?? {}) } as Record<string, string>;
    if (v) {
      let w = Number(v.width) || null;
      let h = Number(v.height) || null;
      const rot = Number(v.tags?.rotate ?? v.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? 0);
      if (w && h && Math.abs(rot) % 180 === 90) [w, h] = [h, w];
      meta.width = w;
      meta.height = h;
    }
    meta.duration = Number(j.format?.duration) || null;
    // Apple's tag keeps the local offset ("2026-09-24T14:30:05+0530"); creation_time is UTC.
    const apple = tags['com.apple.quicktime.creationdate'];
    const created = apple ? apple.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : tags['creation_time'];
    if (created && !isNaN(Date.parse(created))) meta.takenAt = new Date(created).toISOString();
    const loc = parseIso6709(tags['com.apple.quicktime.location.ISO6709'] ?? tags['location']);
    if (loc) [meta.lat, meta.lon] = loc;
    meta.camera = tags['com.apple.quicktime.model'] ?? null;
  } catch {
    /* unreadable container: keep file-date fallback */
  }
  return meta;
}

/**
 * Decode with libheif's native command-line tool (fast on a Raspberry Pi). libheif applies the photo's
 * rotation while decoding, so the result is used as-is. Temp files go to the SSD, not the Pi's SD card.
 */
async function heifDecNative(abs: string, tool: string, tmpDir: string): Promise<Buffer> {
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const base = path.join(tmpDir, `heif-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await run(tool, [abs, `${base}.jpg`], 120_000);
    // Older heif-convert numbers its output when a file holds several images (IMG-1.jpg, IMG-2.jpg...).
    for (const out of [`${base}.jpg`, `${base}-1.jpg`, `${base}-primary.jpg`]) {
      if (fs.existsSync(out)) return await fs.promises.readFile(out);
    }
    throw new Error('the decoder produced no image');
  } finally {
    const prefix = path.basename(base);
    for (const f of await fs.promises.readdir(tmpDir).catch(() => [] as string[])) {
      if (f.startsWith(prefix)) await fs.promises.rm(path.join(tmpDir, f), { force: true });
    }
  }
}

async function heicToSharp(abs: string, native?: { tool: string | null; tmpDir: string }): Promise<Sharp> {
  if (native?.tool) {
    try {
      return sharp(await heifDecNative(abs, native.tool, native.tmpDir), { failOn: 'none' });
    } catch {
      /* fall back to the built-in WebAssembly decoder below */
    }
  }
  const buffer = await fs.promises.readFile(abs);
  try {
    const { width, height, data } = await decodeHeic({ buffer });
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
  } catch (err) {
    // Some ".heic" files are really AVIF, which sharp reads natively.
    if (err instanceof TypeError) return sharp(buffer, { failOn: 'none' }).rotate();
    throw err;
  }
}

async function videoFrame(abs: string, ffmpeg: string): Promise<Buffer> {
  const args = (at: string) => ['-hide_banner', '-loglevel', 'error', '-ss', at, '-i', abs, '-frames:v', '1', '-vf', 'scale=960:-2', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'];
  const frame = await run(ffmpeg, args('1'), 60_000);
  if (frame.length) return frame;
  return run(ffmpeg, args('0'), 60_000); // clips shorter than a second
}

async function writeAtomic(img: Sharp, out: string) {
  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmp, await img.toBuffer());
  await fs.promises.rename(tmp, out);
}

/**
 * Background worker: hashes media, extracts dates/GPS/size, renders thumbnails. Items the user is looking
 * at right now (thumbnail requests) jump the queue via ensure().
 */
export class MediaQueue {
  rt: Runtime;
  private inflight = new Map<number, Promise<FileRow | null>>();
  private noThumb = new Set<string>();
  private workers = 0;
  private maxWorkers = 2;
  private stopped = true;

  constructor(rt: Runtime) {
    this.rt = rt;
  }

  thumbPath(sha: string) {
    return path.join(this.rt.paths.thumbs, sha.slice(0, 2), `${sha}.webp`);
  }

  previewPath(sha: string) {
    return path.join(this.rt.paths.previews, sha.slice(0, 2), `${sha}.webp`);
  }

  start() {
    this.stopped = false;
    this.kick();
  }

  stop() {
    this.stopped = true;
  }

  async idle() {
    await Promise.allSettled([...this.inflight.values()]);
  }

  pendingCount(): number {
    if (!this.rt.db) return 0;
    return (this.rt.db.prepare(`SELECT COUNT(*) AS n FROM files WHERE media_state = 'pending'`).get() as { n: number }).n;
  }

  kick() {
    if (this.stopped || !this.rt.background) return;
    // A bounded count, not `while (workers < max)`: a worker that finds nothing to do finishes synchronously
    // and decrements `workers` straight away, which would make a while loop spin forever.
    for (let n = this.maxWorkers - this.workers; n > 0; n--) {
      this.workers++;
      void this.loop();
    }
  }

  private async loop() {
    try {
      while (!this.stopped && this.rt.state === 'online') {
        const id = this.nextPending();
        if (id === null) break;
        await this.ensure(id);
      }
    } catch (err) {
      this.rt.log('Media worker error:', err);
    } finally {
      this.workers--;
    }
  }

  private nextPending(): number | null {
    const db = this.rt.db;
    if (!db) return null;
    const rows = db.prepare(`SELECT id FROM files WHERE media_state = 'pending' ORDER BY id DESC LIMIT 8`).all() as { id: number }[];
    const free = rows.find((r) => !this.inflight.has(r.id));
    return free ? free.id : null;
  }

  /** Process now if still pending; concurrent callers share one job. */
  ensure(id: number): Promise<FileRow | null> {
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const job = this.process(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, job);
    return job;
  }

  private async process(id: number): Promise<FileRow | null> {
    const db = this.rt.db;
    if (!db) return null;
    const row = this.rt.indexer.getById(id);
    if (!row || row.media_state !== 'pending') return row ?? null;
    const root = spaceRoot(this.rt, row.space);
    if (!root) {
      db.prepare('DELETE FROM files WHERE id = ?').run(id);
      return null;
    }
    const abs = path.join(root, '.' + row.path);
    try {
      const sha = row.sha256 ?? (await hashFile(abs));
      const meta = row.kind === 'video' ? await videoMeta(abs, this.rt.tools.ffprobe) : await imageMeta(abs, row.name);
      await this.makeThumb(abs, row, sha).catch((err) => this.rt.log(`No thumbnail for ${row.path}: ${(err as Error).message}`));
      if (!this.rt.db) return null;
      // A date supplied at upload (the phone's own record) beats EXIF; EXIF beats the file's modified time.
      const takenAt = row.taken_at ?? meta.takenAt;
      const ts = takenAt ? Date.parse(takenAt) : row.mtime;
      this.rt.db
        .prepare(
          `UPDATE files SET sha256 = ?, taken_at = ?, ts = ?, width = ?, height = ?, duration = ?, lat = ?, lon = ?, camera = ?, media_state = 'done'
           WHERE id = ? AND media_state = 'pending'`,
        )
        .run(sha, takenAt, ts, meta.width, meta.height, meta.duration, meta.lat, meta.lon, meta.camera, id);
    } catch (err) {
      if (this.rt.state !== 'online' || !this.rt.db) return null; // drive vanished: leave pending for later
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.rt.db.prepare('DELETE FROM files WHERE id = ?').run(id);
        return null;
      }
      this.rt.db.prepare(`UPDATE files SET media_state = 'error' WHERE id = ?`).run(id);
      this.rt.log(`Media processing failed for ${row.path}: ${(err as Error).message}`);
    }
    return this.rt.indexer.getById(id) ?? null;
  }

  private async makeThumb(abs: string, row: FileRow, sha: string) {
    const out = this.thumbPath(sha);
    if (fs.existsSync(out)) return;
    let img: Sharp;
    if (row.kind === 'video') {
      if (!this.rt.tools.ffmpeg) return;
      img = sharp(await videoFrame(abs, this.rt.tools.ffmpeg));
    } else if (isHeic(row.name)) {
      img = await heicToSharp(abs, { tool: this.rt.tools.heifDec, tmpDir: this.rt.paths.tmp });
    } else if (canThumbImage(row.name)) {
      img = (await sharpFrom(abs)).rotate();
    } else {
      return;
    }
    await writeAtomic(img.resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }), out);
  }

  /** Thumbnail file for a row, generating it first if needed. Null when the format has no thumbnail. */
  async thumbFor(row: FileRow): Promise<string | null> {
    const done = row.media_state === 'pending' ? await this.ensure(row.id) : row;
    if (!done?.sha256) return null;
    const p = this.thumbPath(done.sha256);
    if (fs.existsSync(p)) return p;
    if (this.noThumb.has(done.sha256)) return null;
    // Thumbnail cache was cleared (or never made): rebuild once, and remember formats that cannot be drawn.
    const root = spaceRoot(this.rt, done.space);
    if (root) await this.makeThumb(path.join(root, '.' + done.path), done, done.sha256).catch(() => {});
    if (fs.existsSync(p)) return p;
    this.noThumb.add(done.sha256);
    return null;
  }

  /** Large browser-friendly rendition for formats browsers cannot draw (HEIC, TIFF). */
  async previewFor(row: FileRow, abs: string): Promise<string | null> {
    const done = row.media_state === 'pending' ? await this.ensure(row.id) : row;
    const sha = done?.sha256 ?? (await hashFile(abs));
    const out = this.previewPath(sha);
    if (fs.existsSync(out)) return out;
    const img = isHeic(row.name) ? await heicToSharp(abs, { tool: this.rt.tools.heifDec, tmpDir: this.rt.paths.tmp }) : (await sharpFrom(abs)).rotate();
    await writeAtomic(img.resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }), out);
    return out;
  }
}
