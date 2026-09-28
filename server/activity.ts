import type { Runtime } from './runtime.ts';
import { audienceOf } from './spaces.ts';

export interface ActivityInput {
  userId?: number | null;
  deviceId?: number | null;
  action: string;
  space?: string | null;
  path?: string | null;
  detail?: string | null;
}

export function logActivity(rt: Runtime, a: ActivityInput) {
  const db = rt.db;
  if (!db) return;
  const at = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO activity (at, user_id, device_id, action, space, path, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(at, a.userId ?? null, a.deviceId ?? null, a.action, a.space ?? null, a.path ?? null, a.detail ?? null);
  const event = { id: Number(info.lastInsertRowid), at, ...a };
  if (a.space) {
    const aud = audienceOf(rt, a.space);
    rt.events.emit('activity', event, { userIds: [...aud.userIds, ...(a.userId ? [a.userId] : [])], admins: true });
  } else {
    rt.events.emit('activity', event, { userIds: a.userId ? [a.userId] : [], admins: true });
  }
}
