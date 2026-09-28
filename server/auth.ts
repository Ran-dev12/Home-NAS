import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.ts';
import { HttpError, forbidden, unauthorized } from './http.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

export const SESSION_COOKIE = 'hn_sid';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(key, expected);
}

export function checkPasswordStrength(pw: string) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'weak_password', 'Password must be at least 8 characters');
  if (pw.length > 200) throw new HttpError(400, 'weak_password', 'Password is too long');
}

export function createSession(db: Db, userId: number, userAgent: string, ip: string): string {
  const token = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(sha256(token), userId, now.toISOString(), now.toISOString(), expires.toISOString(), userAgent.slice(0, 300), ip);
  return token;
}

export function destroySession(db: Db, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

interface SessionRow {
  user_id: number;
  last_seen_at: string;
  expires_at: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  disabled: number;
}

export function lookupSession(db: Db, token: string): SessionUser | null {
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT s.user_id, s.last_seen_at, s.expires_at, u.username, u.display_name, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(hash) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) < now || row.disabled) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  // Sliding expiry, written at most every 10 minutes to keep the database quiet.
  if (now - Date.parse(row.last_seen_at) > 10 * 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(
      new Date(now).toISOString(),
      new Date(now + SESSION_DAYS * 86400_000).toISOString(),
      hash,
    );
  }
  return { id: row.user_id, username: row.username, displayName: row.display_name, role: row.role };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_DAYS * 86400_000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function clientIp(req: Request): string {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

export function isLocalRequest(req: Request): boolean {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1';
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Only an administrator can do this'));
  next();
}

/**
 * Cookie-authenticated writes must carry X-HomeNAS: 1. Browsers will not add a custom header to a
 * cross-site form post, and a cross-site fetch that adds one needs a CORS preflight we never grant.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (safe || !req.user) return next();
  if (req.get('x-homenas') !== '1') return next(forbidden('Request blocked (missing X-HomeNAS header)'));
  next();
}

/** Counts failures per key; blocks after `max` failures inside `windowMs`. */
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  check(key: string) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, list);
    if (list.length >= this.max) {
      const wait = Math.ceil((this.windowMs - (now - list[0])) / 60_000);
      throw new HttpError(429, 'too_many_attempts', `Too many failed attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    }
  }
  fail(key: string) {
    const list = this.hits.get(key) || [];
    list.push(Date.now());
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.clear();
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
const RESERVED_USERNAMES = /^(con|prn|aux|nul|com\d|lpt\d|admin-?tools|shared|users|public)$/i;

export function validateUsername(raw: unknown): string {
  const u = typeof raw === 'string' ? raw.trim() : '';
  if (!USERNAME_RE.test(u)) {
    throw new HttpError(400, 'bad_username', 'Username must be 2-32 characters: letters, numbers, dot, dash or underscore');
  }
  if (RESERVED_USERNAMES.test(u) || u.endsWith('.')) throw new HttpError(400, 'bad_username', 'That username is reserved');
  return u.toLowerCase();
}
