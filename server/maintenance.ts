import fs from 'node:fs';
import path from 'node:path';
import type { Runtime } from './runtime.ts';
import { purgeExpired } from './trash.ts';

/** Periodic housekeeping: expired trash, stale temp uploads, old sessions and activity. */
export async function runMaintenance(rt: Runtime) {
  if (rt.state !== 'online' || !rt.db) return;
  const purged = await purgeExpired(rt);
  if (purged) rt.log(`Trash: permanently removed ${purged} item(s) past the retention period`);

  const dayAgo = Date.now() - 86400_000;
  try {
    for (const f of await fs.promises.readdir(rt.paths.tmp)) {
      const p = path.join(rt.paths.tmp, f);
      const st = await fs.promises.stat(p).catch(() => null);
      if (st && st.mtimeMs < dayAgo) await fs.promises.rm(p, { force: true, recursive: true });
    }
  } catch {
    /* tmp may not exist yet */
  }

  if (!rt.db) return;
  const now = new Date().toISOString();
  rt.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  rt.db.prepare('DELETE FROM activity WHERE at < ?').run(new Date(Date.now() - 180 * 86400_000).toISOString());
  rt.db.prepare(`UPDATE share_links SET revoked = 1 WHERE revoked = 0 AND expires_at IS NOT NULL AND expires_at < ?`).run(now);
}
