import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { ZipArchive } from 'archiver';
import { inlinePolicy } from './kinds.ts';
import { isHiddenName } from './paths.ts';

export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Send a user file. Uploaded content is untrusted, so: nosniff everywhere, a sandbox CSP (no script, no
 * same-origin access), and HTML/SVG/JS only ever go out as text/plain or as a download.
 */
export function sendUserFile(req: Request, res: Response, next: NextFunction, abs: string, name: string, download: boolean) {
  const policy = inlinePolicy(name);
  const asAttachment = download || policy.mode === 'attachment';
  res.setHeader('Content-Type', policy.type);
  res.setHeader('Content-Disposition', contentDisposition(asAttachment ? 'attachment' : 'inline', name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Chrome's PDF viewer refuses to run inside a sandboxed document, and a PDF cannot script our origin anyway.
  if (policy.type !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.sendFile(abs, { dotfiles: 'allow', lastModified: true, etag: true, acceptRanges: true }, (err) => {
    if (!err) return;
    const code = (err as NodeJS.ErrnoException).code;
    if (res.headersSent || code === 'ECONNABORTED' || code === 'ECONNRESET') return; // viewer seeked or closed
    next(err);
  });
}

export function sendThumb(res: Response, next: NextFunction, file: string) {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) next(err);
  });
}

export interface ZipItem {
  abs: string;
  name: string;
  isDir: boolean;
}

/** Stream a zip without compression: photos and video do not shrink, and storing is far faster. */
export function streamZip(res: Response, zipName: string, items: ZipItem[]) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('attachment', zipName.endsWith('.zip') ? zipName : `${zipName}.zip`));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const zip = new ZipArchive({ store: true });
  zip.on('warning', () => {});
  zip.on('error', (err: Error) => res.destroy(err));
  res.on('close', () => {
    if (!res.writableFinished) zip.abort();
  });
  zip.pipe(res);
  for (const it of items) {
    if (it.isDir) {
      zip.directory(it.abs, it.name, (entry) => (isHiddenName(path.basename(entry.name)) ? false : entry));
    } else {
      zip.file(it.abs, { name: it.name });
    }
  }
  void zip.finalize();
}
