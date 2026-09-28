import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';
import { Runtime } from './runtime.ts';
import { answerClientErrors, createApp, wantsPage } from './app.ts';
import { lanAddresses } from './net.ts';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const configPath = path.resolve(appDir, arg('--config') ?? process.env.HOMENAS_CONFIG ?? path.join('data', 'config.json'));

const rt = new Runtime({ appDir, configPath, prod });

/** "0.1.0 (c6eb397)": shows at a glance whether this PC runs the latest code after a git pull. */
function versionLabel(): string {
  let version = '';
  try {
    version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version ?? '';
  } catch {
    /* unknown */
  }
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: appDir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
    if (commit) version += ` (${commit})`;
  } catch {
    /* not a git checkout, or git is not installed */
  }
  return version;
}
if (arg('--port')) rt.config.port = Number(arg('--port'));
rt.boot();

const server = http.createServer();
// Node's default 5-minute request timeout would kill large uploads over Wi-Fi.
server.requestTimeout = 6 * 3600_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;

const frontend: RequestHandler[] = [];
if (prod) {
  const dist = path.join(appDir, 'dist');
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error('The web interface has not been built. Run: npm run build');
    process.exit(1);
  }
  frontend.push(express.static(dist, { index: false, maxAge: '7d', immutable: true }));
  frontend.push((req, res, next) => {
    // Only a browser loading a page asks for text/html. Anything else (a shortcut, a script) gets JSON.
    if (req.method !== 'GET' || req.path.startsWith('/api/') || !wantsPage(req)) return next();
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: appDir, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  frontend.push(vite.middlewares);
}

server.on('request', createApp(rt, frontend));
answerClientErrors(server, rt);

server.listen(rt.config.port, rt.config.host, () => {
  const port = rt.config.port;
  const lines = [
    '',
    '  HomeNAS is running' + (prod ? '' : ' (development mode)'),
    `  Version:         ${versionLabel()}`,
    `  On this PC:      http://localhost:${port}`,
    ...lanAddresses().map((a) => `  ${a.kind === 'tailscale' ? 'Via Tailscale:  ' : 'On your Wi-Fi:  '} http://${a.address}:${port}`),
    `  Storage:         ${rt.config.storageRoot ?? '(not set up yet)'}${rt.config.storageRoot ? ` [${rt.state}]` : ''}`,
  ];
  if (rt.state !== 'online') {
    lines.push(`  Setup code:      ${rt.setupCode}   (needed when setting up from another device)`);
    if (rt.state === 'offline') lines.push(`  Waiting for the drive: ${rt.offlineReason}`);
  }
  console.log(lines.join('\n') + '\n');
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${rt.config.port} is already in use. Is HomeNAS already running?`);
  else console.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => rt.log('Unhandled error:', err));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('Stopping HomeNAS...');
  server.close();
  server.closeAllConnections();
  await rt.shutdown();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
