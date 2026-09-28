import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Runtime } from '../server/runtime.ts';
import { createApp } from '../server/app.ts';

export interface TestServer {
  rt: Runtime;
  base: string;
  dir: string;
  volume: string;
  close: () => Promise<void>;
}

export function tempDir(label: string): string {
  const dir = path.join(os.tmpdir(), 'homenas-tests', `${label}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function startServer(label: string, opts: { background?: boolean } = {}): Promise<TestServer> {
  const dir = tempDir(label);
  const volume = path.join(dir, 'ssd');
  fs.mkdirSync(volume);
  const rt = new Runtime({ appDir: dir, configPath: path.join(dir, 'config.json'), prod: true, quiet: true, background: opts.background ?? false, monitorMs: 60_000 });
  rt.config.port = 0;
  rt.boot();
  const server = http.createServer(createApp(rt));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    rt,
    base,
    dir,
    volume,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rt.shutdown();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

/** Minimal browser: keeps cookies and sends the CSRF header like the real UI. */
export class Client {
  base: string;
  cookies = new Map<string, string>();
  csrf = true;

  constructor(base: string) {
    this.base = base;
  }

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any; text: string; headers: Headers }> {
    const h: Record<string, string> = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf) h['x-homenas'] = '1';
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (!v || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  get(url: string) {
    return this.req('GET', url);
  }
  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.req('POST', url, body ?? {}, headers);
  }
  patch(url: string, body: unknown) {
    return this.req('PATCH', url, body);
  }
  del(url: string) {
    return this.req('DELETE', url);
  }

  async upload(space: string, dir: string, files: { name: string; data: string | Buffer; relpath?: string }[], extra: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    for (const f of files) {
      if (f.relpath) fd.append('relpath', f.relpath);
      fd.append('file', new Blob([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)]), f.name);
    }
    return this.req('POST', `/api/fs/upload?space=${encodeURIComponent(space)}&path=${encodeURIComponent(dir)}`, fd);
  }
}

/** Set up a fresh server with an admin account, signed in. */
export async function setupWithAdmin(label: string, opts: { background?: boolean } = {}) {
  const srv = await startServer(label, opts);
  const admin = new Client(srv.base);
  const r = await admin.post('/api/setup/complete', {
    path: srv.volume,
    volumeName: 'Test SSD',
    serverName: 'TestNAS',
    admin: { username: 'ranjeet', displayName: 'Ranjeet', password: 'correct horse' },
  });
  if (r.status !== 200) throw new Error(`setup failed: ${r.status} ${r.text}`);
  const me = await admin.get('/api/me');
  return { srv, admin, adminId: me.json.user.id as number };
}

export async function addUser(admin: Client, base: string, username: string, role: 'admin' | 'member' = 'member') {
  const created = await admin.post('/api/admin/users', { username, displayName: username, password: 'password123', role });
  if (created.status !== 200) throw new Error(`add user failed: ${created.text}`);
  const c = new Client(base);
  const login = await c.post('/api/auth/login', { username, password: 'password123' });
  if (login.status !== 200) throw new Error(`login failed: ${login.text}`);
  return { client: c, id: created.json.id as number };
}
