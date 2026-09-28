import path from 'node:path';

export type Kind = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'text' | 'archive' | 'other';

const EXT_KIND: Record<string, Kind> = {};
const add = (kind: Kind, exts: string) => exts.split(' ').forEach((e) => (EXT_KIND[e] = kind));
add('image', 'jpg jpeg png gif webp avif bmp tif tiff heic heif dng svg ico');
add('video', 'mov mp4 m4v 3gp mkv avi webm wmv mts m2ts');
add('audio', 'mp3 m4a aac wav flac ogg opus wma aiff');
add('document', 'pdf doc docx xls xlsx ppt pptx odt ods odp rtf pages numbers key');
add('text', 'txt md csv log json xml yml yaml ini cfg conf html htm css js ts tsx jsx py sh ps1 bat sql');
add('archive', 'zip rar 7z tar gz tgz bz2 xz iso');

export function extOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

export function kindOf(name: string, isDir: boolean): Kind {
  if (isDir) return 'folder';
  return EXT_KIND[extOf(name)] ?? 'other';
}

export function isMedia(kind: string): boolean {
  return kind === 'image' || kind === 'video';
}

/** Formats a browser can draw natively. Anything else image-like needs a server-rendered preview. */
const BROWSER_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico']);
export function browserCanShowImage(name: string): boolean {
  return BROWSER_IMAGE.has(extOf(name));
}

/** Image formats we can make thumbnails for (sharp natively, HEIC via heic-decode). */
const THUMBABLE_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'tif', 'tiff', 'heic', 'heif', 'bmp']);
export function canThumbImage(name: string): boolean {
  return THUMBABLE_IMAGE.has(extOf(name));
}

export function isHeic(name: string): boolean {
  const e = extOf(name);
  return e === 'heic' || e === 'heif';
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif',
  svg: 'image/svg+xml', dng: 'image/x-adobe-dng',
  // iPhone .mov is H.264/HEVC in an MP4-compatible container; labelling it video/mp4 lets Chrome and Edge try to play it.
  mov: 'video/mp4', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
  avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg',
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json',
  txt: 'text/plain', md: 'text/plain', csv: 'text/plain', log: 'text/plain',
};

export function mimeOf(name: string): string {
  return MIME[extOf(name)] ?? 'application/octet-stream';
}

/**
 * How a file may be shown inline. User uploads are untrusted: HTML/SVG/JS served inline from this
 * origin could run script with the viewer's session, so text-like files are only ever sent as text/plain.
 */
export function inlinePolicy(name: string): { mode: 'inline' | 'text' | 'attachment'; type: string } {
  const kind = kindOf(name, false);
  const ext = extOf(name);
  if (ext === 'svg') return { mode: 'text', type: 'text/plain; charset=utf-8' };
  if (kind === 'image' && browserCanShowImage(name)) return { mode: 'inline', type: mimeOf(name) };
  if (kind === 'video' || kind === 'audio') return { mode: 'inline', type: mimeOf(name) };
  if (ext === 'pdf') return { mode: 'inline', type: 'application/pdf' };
  if (kind === 'text') return { mode: 'text', type: 'text/plain; charset=utf-8' };
  return { mode: 'attachment', type: mimeOf(name) };
}
