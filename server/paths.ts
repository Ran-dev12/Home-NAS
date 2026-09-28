import fs from 'node:fs';
import path from 'node:path';
import { badRequest, forbidden } from './http.ts';

// Characters Windows (NTFS/exFAT) refuses in names. ':' also blocks NTFS alternate data streams.
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const BAD_CHAR_TEST = /[<>:"/\\|?*\u0000-\u001f]/;
const BAD_SEGMENT_TEST = /[<>:"|?*\u0000-\u001f]/;
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const MAX_NAME_BYTES = 200;

/** Junk the OS drops into folders; hidden from listings. */
const HIDDEN_NAMES = new Set(['thumbs.db', 'desktop.ini', '.ds_store', '$recycle.bin', 'system volume information', '.homenas']);

export function isHiddenName(name: string) {
  return HIDDEN_NAMES.has(name.toLowerCase()) || name.startsWith('._');
}

function truncateBytes(name: string): string {
  if (Buffer.byteLength(name) <= MAX_NAME_BYTES) return name;
  const ext = path.extname(name);
  let stem = name.slice(0, name.length - ext.length);
  while (stem && Buffer.byteLength(stem + ext) > MAX_NAME_BYTES) stem = stem.slice(0, -1);
  return stem + ext;
}

/** Turn any incoming name (upload, phone, device name) into one that is safe on Windows. Never throws. */
export function sanitizeName(raw: string, fallback = 'file'): string {
  let n = String(raw ?? '')
    .normalize('NFC')
    .replace(BAD_CHARS, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (!n || n === '.' || n === '..') n = fallback;
  if (WIN_RESERVED.test(n)) n = '_' + n;
  if (n.toLowerCase() === '.homenas') n = '_homenas';
  return truncateBytes(n);
}

/** Strict check for names a person typed (new folder, rename). Throws with a readable message. */
export function validateName(raw: string): string {
  const n = String(raw ?? '').normalize('NFC').trim();
  if (!n) throw badRequest('Name cannot be empty');
  if (n === '.' || n === '..') throw badRequest('That name is not allowed');
  if (BAD_CHAR_TEST.test(n)) throw badRequest('Names cannot contain < > : " / \\ | ? *');
  if (/[. ]$/.test(n)) throw badRequest('Names cannot end with a dot or a space');
  if (WIN_RESERVED.test(n)) throw badRequest(`"${n}" is a reserved name on Windows`);
  if (Buffer.byteLength(n) > MAX_NAME_BYTES) throw badRequest('Name is too long');
  if (n.toLowerCase() === '.homenas') throw badRequest('That name is reserved');
  return n;
}

/** Normalise a space-relative path to "/a/b" form. Rejects traversal and invalid segments. */
export function normalizeRel(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '/';
  if (typeof raw !== 'string') throw badRequest('path must be text');
  const segs = raw.split(/[/\\]+/).filter((s) => s !== '' && s !== '.');
  for (const s of segs) {
    if (s === '..') throw forbidden('Path escapes the folder');
    if (BAD_SEGMENT_TEST.test(s)) throw badRequest('Path contains characters that are not allowed');
    if (s.toLowerCase() === '.homenas') throw forbidden('That folder is reserved');
  }
  return '/' + segs.map((s) => s.normalize('NFC')).join('/');
}

export function joinRel(parent: string, name: string): string {
  return parent === '/' ? '/' + name : parent + '/' + name;
}

export function parentRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i <= 0 ? '/' : rel.slice(0, i);
}

export function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

/** True if `rel` is `ancestor` or inside it (case-insensitive, like NTFS). */
export function isWithinRel(rel: string, ancestor: string): boolean {
  if (ancestor === '/') return true;
  const a = ancestor.toLowerCase();
  const r = rel.toLowerCase();
  return r === a || r.startsWith(a + '/');
}

/** True if a path.relative() result leads out of its base. A name like "..notes" stays inside. */
function leavesBase(back: string): boolean {
  return back === '..' || back.startsWith('..' + path.sep) || path.isAbsolute(back);
}

/** Absolute path for a space-relative path, guaranteed to stay inside spaceRoot (including via symlinks/junctions). */
export function toAbs(spaceRoot: string, rel: string): string {
  const abs = path.resolve(spaceRoot, '.' + rel);
  const back = path.relative(spaceRoot, abs);
  if (leavesBase(back)) throw forbidden('Path escapes the folder');
  assertRealpathInside(spaceRoot, abs);
  return abs;
}

function assertRealpathInside(spaceRoot: string, abs: string) {
  // Resolve the nearest existing ancestor; a junction or symlink pointing outside is refused.
  let probe = abs;
  while (!fs.existsSync(probe)) {
    const up = path.dirname(probe);
    if (up === probe) return;
    probe = up;
  }
  let realRoot: string;
  let realProbe: string;
  try {
    realRoot = fs.realpathSync.native(spaceRoot);
    realProbe = fs.realpathSync.native(probe);
  } catch {
    return;
  }
  if (leavesBase(path.relative(realRoot, realProbe))) throw forbidden('Path escapes the folder');
}

/** "IMG_1.jpg" -> "IMG_1 (1).jpg" until free. The existence check follows the filesystem's case rules. */
export function uniqueName(dirAbs: string, name: string): string {
  if (!fs.existsSync(path.join(dirAbs, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!fs.existsSync(path.join(dirAbs, candidate))) return candidate;
  }
  throw new Error(`Could not find a free name for ${name}`);
}
