import { Router } from 'express';
import type { Runtime } from '../runtime.ts';
import { requireUser } from '../auth.ts';

/** Live updates for the web UI (upload finished, phone synced, drive unplugged...). */
export function eventRoutes(rt: Runtime): Router {
  const r = Router();
  r.get('/api/events', requireUser, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ state: rt.state })}\n\n`);
    const remove = rt.events.add(req.user!.id, req.user!.role === 'admin', res);
    req.on('close', remove);
  });
  return r;
}
