import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  const e = err as NodeJS.ErrnoException & { type?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'Request body is not valid JSON' });
    return;
  }
  if (e?.code === 'ENOENT') {
    res.status(404).json({ error: 'not_found', message: 'That file or folder no longer exists' });
    return;
  }
  if (e?.code === 'ENOSPC') {
    res.status(507).json({ error: 'disk_full', message: 'The storage drive is full' });
    return;
  }
  if (e?.code === 'EBUSY' || e?.code === 'EPERM') {
    res.status(409).json({ error: 'file_locked', message: 'The file is in use by another program. Close it and try again.' });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong on the server' });
}

export function str(v: unknown, name: string, opts: { optional?: boolean; max?: number } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw badRequest(`${name} is required`);
  }
  if (typeof v !== 'string') throw badRequest(`${name} must be text`);
  if (opts.max && v.length > opts.max) throw badRequest(`${name} is too long`);
  return v;
}

export function nowIso() {
  return new Date().toISOString();
}
