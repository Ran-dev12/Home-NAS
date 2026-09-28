import express, { type RequestHandler } from 'express';
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

export function createApp(rt: Runtime, frontend: RequestHandler[] = []): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
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

  for (const h of frontend) app.use(h);

  app.use(errorHandler);
  return app;
}
