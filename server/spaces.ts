import fs from 'node:fs';
import path from 'node:path';
import type { Runtime } from './runtime.ts';
import type { SessionUser } from './auth.ts';
import { badRequest, forbidden, notFound } from './http.ts';

export type Access = 'read' | 'write';

export interface Space {
  /** "u:<userId>" for a home, "s:<spaceId>" for a shared folder. */
  id: string;
  kind: 'home' | 'shared';
  name: string;
  root: string;
  access: Access;
  ownerId: number | null;
  sharedId: number | null;
}

type SpaceRow = {
  id: number;
  name: string;
  folder: string;
}

export function homeRoot(rt: Runtime, username: string): string {
  return path.join(rt.paths.users, username);
}

export function sharedRoot(rt: Runtime, folder: string): string {
  return path.join(rt.paths.shared, folder);
}

function parseSpaceId(id: unknown): { kind: 'home' | 'shared'; num: number } {
  if (typeof id !== 'string') throw badRequest('space is required');
  const m = /^(u|s):(\d+)$/.exec(id);
  if (!m) throw badRequest('Unknown space');
  return { kind: m[1] === 'u' ? 'home' : 'shared', num: Number(m[2]) };
}

/** Every space this user may see, home first. */
export function listSpacesFor(rt: Runtime, user: SessionUser): Space[] {
  const db = rt.requireDb();
  const out: Space[] = [
    { id: `u:${user.id}`, kind: 'home', name: 'My files', root: homeRoot(rt, user.username), access: 'write', ownerId: user.id, sharedId: null },
  ];
  const rows =
    user.role === 'admin'
      ? (db.prepare(`SELECT id, name, folder, 'write' AS access FROM spaces ORDER BY name`).all() as (SpaceRow & { access: Access })[])
      : (db
          .prepare(
            `SELECT s.id, s.name, s.folder, m.access FROM spaces s JOIN space_members m ON m.space_id = s.id
             WHERE m.user_id = ? ORDER BY s.name`,
          )
          .all(user.id) as (SpaceRow & { access: Access })[]);
  for (const r of rows) {
    out.push({ id: `s:${r.id}`, kind: 'shared', name: r.name, root: sharedRoot(rt, r.folder), access: r.access, ownerId: null, sharedId: r.id });
  }
  return out;
}

/** Resolve a space for a user and require at least `need` access. Homes are private, even from admins. */
export function resolveSpace(rt: Runtime, user: SessionUser, id: unknown, need: Access): Space {
  const { kind, num } = parseSpaceId(id);
  const db = rt.requireDb();
  let space: Space;
  if (kind === 'home') {
    if (num !== user.id) throw forbidden('That is another person’s private folder');
    space = listSpacesFor(rt, user)[0];
  } else {
    const row = db.prepare('SELECT id, name, folder FROM spaces WHERE id = ?').get(num) as SpaceRow | undefined;
    if (!row) throw notFound('That shared folder no longer exists');
    let access: Access | null = null;
    if (user.role === 'admin') access = 'write';
    else {
      const m = db.prepare('SELECT access FROM space_members WHERE space_id = ? AND user_id = ?').get(num, user.id) as { access: Access } | undefined;
      access = m?.access ?? null;
    }
    if (!access) throw forbidden('You are not a member of that shared folder');
    space = { id: `s:${row.id}`, kind: 'shared', name: row.name, root: sharedRoot(rt, row.folder), access, ownerId: null, sharedId: row.id };
  }
  if (need === 'write' && space.access !== 'write') throw forbidden('You have read-only access to this folder');
  fs.mkdirSync(space.root, { recursive: true });
  return space;
}

/** Root folder of a space with no access check (indexer, thumbnails, share links, devices). */
export function spaceRoot(rt: Runtime, id: string): string | null {
  const m = /^(u|s):(\d+)$/.exec(id);
  if (!m) return null;
  const db = rt.requireDb();
  if (m[1] === 'u') {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(m[2])) as { username: string } | undefined;
    return u ? homeRoot(rt, u.username) : null;
  }
  const s = db.prepare('SELECT folder FROM spaces WHERE id = ?').get(Number(m[2])) as { folder: string } | undefined;
  return s ? sharedRoot(rt, s.folder) : null;
}

export function allSpaces(rt: Runtime): { id: string; root: string }[] {
  const db = rt.requireDb();
  const users = db.prepare('SELECT id, username FROM users').all() as { id: number; username: string }[];
  const shared = db.prepare('SELECT id, folder FROM spaces').all() as { id: number; folder: string }[];
  return [
    ...users.map((u) => ({ id: `u:${u.id}`, root: homeRoot(rt, u.username) })),
    ...shared.map((s) => ({ id: `s:${s.id}`, root: sharedRoot(rt, s.folder) })),
  ];
}

/** Users who should hear about changes in a space (live updates). */
export function audienceOf(rt: Runtime, spaceId: string): { userIds: number[]; admins: boolean } {
  const m = /^(u|s):(\d+)$/.exec(spaceId);
  if (!m) return { userIds: [], admins: false };
  if (m[1] === 'u') return { userIds: [Number(m[2])], admins: false };
  const rows = rt.requireDb().prepare('SELECT user_id FROM space_members WHERE space_id = ?').all(Number(m[2])) as { user_id: number }[];
  return { userIds: rows.map((r) => r.user_id), admins: true };
}
