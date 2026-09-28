import type http from 'node:http';
import type { Duplex } from 'node:stream';
import express, { type Request, type RequestHandler } from 'express';
import type { Runtime } from './runtime.ts';
import { SESSION_COOKIE, csrfGuard, lookupSession, parseCookies } from './auth.ts';
import { HttpError, errorHandler } from './http.ts';
import { authRoutes } from './routes/auth.ts';
import { fileRoutes } from './routes/files.ts';
import { trashRoutes } from './routes/trash.ts';
import { deviceRoutes } from './routes/devices.ts';
import { shareRoutes } from './routes/shares.ts';
import { adminRoutes } from './routes/admin.ts';
import { eventRoutes } from './routes/events.ts';

/** API paths that must answer even while the drive is unplugged or HomeNAS is not set up. */
const ALWAYS_AVAILABLE = /^\/api\/(status|setup\/|auth\/logout)/;

/** iOS Shortcuts calls with "BackgroundShortcutRunner/… CFNetwork/…" or "Shortcuts/…"; browsers never do. */
const fromShortcut = (req: Request) => /Shortcut/i.test(req.get('user-agent') ?? '');

/** A browser loading a page asks for text/html; shortcuts, scripts and the app's own API calls do not. */
export const wantsPage = (req: Request) => (req.get('accept') ?? '').includes('text/html');

const PHONE_FAILURES: Record<number, string> = {
  401: 'the phone’s key (the Auth text in the shortcut) is wrong or was replaced',
  404: 'the URL in that step of the shortcut is wrong',
  503: 'HomeNAS is not set up yet, or the storage drive is unplugged',
};

function readablePath(p: string): string {
  try {
    return JSON.stringify(decodeURI(p)); // quotes it and shows a stray line break as \n
  } catch {
    return JSON.stringify(p);
  }
}

/**
 * Node rejects a request whose header name has a space in it (a shortcut header typed as "Authorization ")
 * before HomeNAS sees it, with an empty 400 that Shortcuts reports as "couldn't convert from Text to
 * Dictionary". Answer such requests with JSON that says what is wrong, and print it in the HomeNAS window.
 */
export function answerClientErrors(server: http.Server, rt: Runtime) {
  server.on('clientError', (err: NodeJS.ErrnoException, socket: Duplex) => {
    if (err.code === 'ECONNRESET' || !socket.writable) return socket.destroy();
    const badHeader = err.code === 'HPE_INVALID_HEADER_TOKEN';
    const message = badHeader
      ? 'A header name in this request has a space or a character that is not allowed. In the shortcut, check the header key “Authorization” for a space at the end.'
      : 'HomeNAS could not read this request.';
    rt.log(badHeader ? 'A phone sent a header whose name has a space in it (probably “Authorization ” with a space at the end). Fix that header key in the shortcut.' : `Unreadable request (${err.code ?? err.message}).`);
    const body = JSON.stringify({ error: 'bad_request', message });
    socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
}

export function createApp(rt: Runtime, frontend: RequestHandler[] = []): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    // A server address typed with a trailing slash makes a shortcut call "//api/...". Without this, that
    // misses the API and gets the web page back, which Shortcuts reports as "couldn't convert from Text".
    const q = req.url.indexOf('?');
    const pathPart = q < 0 ? req.url : req.url.slice(0, q);
    let p = pathPart.includes('//') ? pathPart.replace(/\/{2,}/g, '/') : pathPart;
    // A Server address saved with extra bits ("…/pair/…", "…/phones", a space or line break) puts them in
    // front of "/api/". Answer the API call anyway, and say what to fix. Browsers loading pages are left alone.
    const at = p.indexOf('/api/');
    if (at > 0 && (!wantsPage(req) || fromShortcut(req))) {
      rt.log(`A phone’s shortcut asked for ${readablePath(p)}. Answering it as ${p.slice(at)}. Fix the shortcut’s Server text: it should be only http://<address>:${rt.config.port}`);
      p = p.slice(at);
    }
    if (p.startsWith('/api/device/') || fromShortcut(req)) {
      // Problems a phone cannot show clearly (Shortcuts hides the answer) are printed here instead.
      res.on('finish', () => {
        if (res.statusCode < 400) return;
        const why = PHONE_FAILURES[res.statusCode] ?? 'see the message on the phone';
        rt.log(`Phone request ${req.method} ${req.originalUrl.split('?')[0]} failed (${res.statusCode}): ${why}.`);
      });
    }
    if (p !== pathPart) req.url = p + (q < 0 ? '' : req.url.slice(q));
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }));

  // Who is calling: resolve the session cookie once per request.
  app.use('/api', (req, _res, next) => {
    if (rt.state === 'online' && rt.db) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        try {
          req.user = lookupSession(rt.db, token) ?? undefined;
        } catch {
          req.user = undefined;
        }
      }
    }
    next();
  });

  app.use('/api', csrfGuard);

  app.use((req, _res, next) => {
    if (!req.path.startsWith('/api/') || ALWAYS_AVAILABLE.test(req.path) || rt.state === 'online') return next();
    next(
      rt.state === 'setup'
        ? new HttpError(503, 'setup_required', 'HomeNAS has not been set up yet')
        : new HttpError(503, 'storage_offline', 'The storage drive is not connected. Plug it in and wait a few seconds.'),
    );
  });

  app.use(authRoutes(rt));
  app.use(fileRoutes(rt));
  app.use(trashRoutes(rt));
  app.use(deviceRoutes(rt));
  app.use(shareRoutes(rt));
  app.use(adminRoutes(rt));
  app.use(eventRoutes(rt));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Unknown API endpoint')));

  // A shortcut must never get the web page: Shortcuts would only say it "couldn't convert from Text".
  app.use((req, _res, next) => {
    if (!fromShortcut(req)) return next();
    next(new HttpError(404, 'not_phone_api', `HomeNAS got a request for “${req.path}”. In the shortcut, the URL must be the Server variable followed directly by /api/device/…`));
  });

  for (const h of frontend) app.use(h);

  // Nothing matched. Answer JSON even here: Express's own "Cannot GET" page is HTML, which a shortcut
  // could only report as "couldn't convert from Text to Dictionary".
  app.use((req, _res, next) => {
    if (!wantsPage(req)) rt.log(`Something that is not a browser asked for ${readablePath(req.path)}. If it was a phone, the URL in that step of its shortcut is wrong.`);
    next(new HttpError(404, 'not_found', `HomeNAS has nothing at “${req.path}”. In a shortcut, the URL must be the Server variable followed directly by /api/device/…`));
  });

  app.use(errorHandler);
  return app;
}
