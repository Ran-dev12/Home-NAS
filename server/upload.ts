import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import type { Request } from 'express';
import { HttpError, badRequest } from './http.ts';
import { diskStats } from './volume.ts';

export interface ReceivedFile {
  field: string;
  filename: string;
  /** Folder path inside the upload (from a "relpath" field sent just before the file), for folder uploads. */
  relpath: string;
  mime: string;
  tmpPath: string;
  size: number;
  sha256: string;
}

export interface Received {
  fields: Record<string, string>;
  files: ReceivedFile[];
}

export interface ReceiveOptions {
  /** Temp folder on the same drive as the destination, so the final move is an atomic rename. */
  tmpDir: string;
  volumeRoot: string;
  maxFileBytes: number;
  minFreeBytes: number;
  maxFiles?: number;
}

const FREE_CHECK_EVERY = 64 * 1024 * 1024;

function outOfSpace() {
  return new HttpError(507, 'disk_full', 'Not enough free space on the storage drive');
}

/**
 * Streams a multipart upload to temp files, hashing as it goes. Nothing is held in memory, and every
 * field is available before the caller decides where files go (iOS Shortcuts may send the date after the file).
 */
export function receiveMultipart(req: Request, opts: ReceiveOptions): Promise<Received> {
  return new Promise((resolve, reject) => {
    const free = diskStats(opts.volumeRoot);
    if (free && free.freeBytes < opts.minFreeBytes) return reject(outOfSpace());

    let bb: Busboy.Busboy;
    try {
      bb = Busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: { fileSize: opts.maxFileBytes, files: opts.maxFiles ?? 50, fields: 100, fieldSize: 64 * 1024 },
      });
    } catch {
      return reject(badRequest('Expected a multipart/form-data upload'));
    }

    fs.mkdirSync(opts.tmpDir, { recursive: true });
    const fields: Record<string, string> = {};
    const files: ReceivedFile[] = [];
    const writes: Promise<void>[] = [];
    let pendingRel = '';
    let failed = false;
    let finished = false;
    let sinceCheck = 0;

    const cleanup = () => {
      for (const f of files) fs.rm(f.tmpPath, { force: true }, () => {});
    };
    const fail = (err: unknown) => {
      if (failed || finished) return;
      failed = true;
      req.unpipe(bb);
      req.resume();
      Promise.allSettled(writes).then(cleanup);
      reject(err);
    };

    bb.on('field', (name, value) => {
      if (name === 'relpath') pendingRel = value;
      else fields[name] = value;
    });

    bb.on('file', (field, stream, info) => {
      if (failed) {
        stream.resume();
        return;
      }
      const entry: ReceivedFile = {
        field,
        filename: info.filename || 'upload',
        relpath: pendingRel,
        mime: info.mimeType,
        tmpPath: path.join(opts.tmpDir, `${crypto.randomUUID()}.part`),
        size: 0,
        sha256: '',
      };
      pendingRel = '';
      files.push(entry);
      const hash = crypto.createHash('sha256');
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          entry.size += chunk.length;
          hash.update(chunk);
          sinceCheck += chunk.length;
          if (sinceCheck >= FREE_CHECK_EVERY) {
            sinceCheck = 0;
            const st = diskStats(opts.volumeRoot);
            if (st && st.freeBytes < opts.minFreeBytes) return cb(outOfSpace());
          }
          cb(null, chunk);
        },
      });
      stream.on('limit', () => fail(new HttpError(413, 'too_large', `${entry.filename} is larger than the upload limit`)));
      writes.push(
        pipeline(stream, tap, fs.createWriteStream(entry.tmpPath)).then(
          () => {
            entry.sha256 = hash.digest('hex');
          },
          (err) => fail(err),
        ),
      );
    });

    bb.on('filesLimit', () => fail(badRequest('Too many files in one upload')));
    bb.on('error', (err) => fail(badRequest(`Upload could not be read: ${(err as Error).message}`)));
    bb.on('close', async () => {
      await Promise.allSettled(writes);
      if (failed) return;
      finished = true;
      resolve({ fields, files });
    });

    req.on('close', () => {
      if (!req.complete && !finished) fail(new HttpError(400, 'aborted', 'Upload was interrupted'));
    });

    req.pipe(bb);
  });
}

export function discard(files: ReceivedFile[]) {
  for (const f of files) fs.rm(f.tmpPath, { force: true }, () => {});
}

/** Move a finished temp file into place. Same drive, so this is a rename, not a copy. */
export async function commitFile(file: ReceivedFile, destAbs: string, mtime?: Date) {
  await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.promises.rename(file.tmpPath, destAbs);
  if (mtime && !isNaN(mtime.getTime())) await fs.promises.utimes(destAbs, mtime, mtime).catch(() => {});
}
