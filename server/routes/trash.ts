import { Router } from 'express';
import type { Runtime } from '../runtime.ts';
import { requireUser } from '../auth.ts';
import { badRequest } from '../http.ts';
import { getTrashFor, purgeTrash, restoreFromTrash, visibleTrash } from '../trash.ts';
import { spaceRoot, listSpacesFor } from '../spaces.ts';
import { logActivity } from '../activity.ts';

function ids(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string')) throw badRequest('ids must be a list');
  return v as string[];
}

export function trashRoutes(rt: Runtime): Router {
  const r = Router();
  r.use('/api/trash', requireUser);

  r.get('/api/trash', (req, res) => {
    const names = new Map(listSpacesFor(rt, req.user!).map((s) => [s.id, s.name]));
    res.json({
      retentionDays: rt.settings().trashDays,
      items: visibleTrash(rt, req.user!).map((t) => ({
        id: t.id,
        space: t.space,
        spaceName: names.get(t.space) ?? '',
        path: t.path,
        name: t.name,
        isDir: !!t.is_dir,
        size: t.size,
        deletedAt: t.deleted_at,
      })),
    });
  });

  r.post('/api/trash/restore', async (req, res) => {
    const restored: { space: string; path: string }[] = [];
    for (const id of ids(req.body?.ids)) {
      const row = getTrashFor(rt, req.user!, id);
      const out = restoreFromTrash(rt, row);
      const root = spaceRoot(rt, out.space);
      if (root) await rt.indexer.scanSubtree(out.space, root, out.path.slice(0, out.path.lastIndexOf('/')) || '/');
      restored.push(out);
    }
    logActivity(rt, { userId: req.user!.id, action: 'restore', space: restored[0]?.space, path: restored[0]?.path, detail: restored.length > 1 ? `${restored.length} items` : null });
    res.json({ restored });
  });

  /** Permanent. The UI asks for confirmation first. */
  r.post('/api/trash/purge', async (req, res) => {
    const rows = req.body?.all === true ? visibleTrash(rt, req.user!) : ids(req.body?.ids).map((id) => getTrashFor(rt, req.user!, id));
    for (const row of rows) await purgeTrash(rt, row);
    if (rows.length) logActivity(rt, { userId: req.user!.id, action: 'purge', detail: `${rows.length} item(s) permanently deleted` });
    res.json({ purged: rows.length });
  });

  return r;
}
