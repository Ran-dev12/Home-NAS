import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client, addUser, setupWithAdmin, startServer, type TestServer } from './helpers.ts';

const servers: TestServer[] = [];
after(async () => {
  for (const s of servers) await s.close();
});

async function fresh(label: string) {
  const ctx = await setupWithAdmin(label);
  servers.push(ctx.srv);
  return ctx;
}

test('before setup, only status and setup endpoints answer', async () => {
  const srv = await startServer('presetup');
  servers.push(srv);
  const c = new Client(srv.base);
  const st = await c.get('/api/status');
  assert.equal(st.json.state, 'setup');
  assert.equal(st.json.needsSetupCode, false, 'requests from this PC need no setup code');
  assert.equal((await c.get('/api/me')).status, 503);
  const inspect = await c.post('/api/setup/inspect', { path: srv.volume });
  assert.equal(inspect.status, 200);
  assert.equal(inspect.json.existingVolume, null);
  // Drive letters only exist on Windows; elsewhere "Q:\..." is just a relative folder name.
  if (process.platform === 'win32') {
    const missing = await c.post('/api/setup/inspect', { path: 'Q:\\definitely-not-a-drive' });
    assert.ok(missing.json.problems.length > 0);
  }
});

test('setup creates the volume marker, the admin, and signs in', async () => {
  const { srv, admin } = await fresh('setup');
  assert.ok(fs.existsSync(path.join(srv.volume, '.homenas', 'volume.json')));
  assert.ok(fs.existsSync(path.join(srv.volume, 'users', 'ranjeet')));
  const me = await admin.get('/api/me');
  assert.equal(me.json.user.username, 'ranjeet');
  assert.equal(me.json.user.role, 'admin');
  const again = await admin.post('/api/setup/complete', { path: srv.volume });
  assert.equal(again.status, 403, 'setup cannot be re-run once online');
});

test('login: wrong password, then rate limiting', async () => {
  const { srv } = await fresh('login');
  const c = new Client(srv.base);
  assert.equal((await c.post('/api/auth/login', { username: 'ranjeet', password: 'nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { username: 'RANJEET', password: 'correct horse' })).status, 200, 'usernames are case-insensitive');
  const bad = new Client(srv.base);
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await bad.post('/api/auth/login', { username: 'ghost', password: 'x' })).status;
  assert.equal(last, 429);
});

test('writes without the X-HomeNAS header are refused (CSRF)', async () => {
  const { admin, adminId } = await fresh('csrf');
  admin.csrf = false;
  const r = await admin.post('/api/fs/mkdir', { space: `u:${adminId}`, path: '/', name: 'x' });
  assert.equal(r.status, 403);
  admin.csrf = true;
});

test('files: upload, list, mkdir, rename, move, copy, download, zip', async () => {
  const { admin, adminId } = await fresh('files');
  const home = `u:${adminId}`;
  const up = await admin.upload(home, '/', [
    { name: 'notes.txt', data: 'hello' },
    { name: 'a.txt', data: 'A', relpath: 'Trip/Day 1' },
  ]);
  assert.equal(up.status, 200, up.text);
  assert.deepEqual(up.json.results.map((r: { path: string }) => r.path), ['/notes.txt', '/Trip/Day 1/a.txt']);

  const dup = await admin.upload(home, '/', [{ name: 'notes.txt', data: 'second' }]);
  assert.equal(dup.json.results[0].path, '/notes (1).txt', 'name clash renames by default');

  const list = await admin.get(`/api/fs/list?space=${home}&path=/`);
  assert.deepEqual(list.json.entries.map((e: { name: string }) => e.name).sort(), ['Trip', 'notes (1).txt', 'notes.txt']);

  assert.equal((await admin.post('/api/fs/mkdir', { space: home, path: '/', name: 'Docs' })).status, 200);
  assert.equal((await admin.post('/api/fs/mkdir', { space: home, path: '/', name: 'docs' })).status, 409, 'NTFS is case-insensitive');
  assert.equal((await admin.post('/api/fs/mkdir', { space: home, path: '/', name: 'bad:name' })).status, 400);

  assert.equal((await admin.post('/api/fs/rename', { space: home, path: '/notes.txt', name: 'Notes.txt' })).status, 200, 'case-only rename');
  assert.equal((await admin.post('/api/fs/rename', { space: home, path: '/notes (1).txt', name: 'Trip' })).status, 409, 'renaming onto a different existing item is refused');
  const mv = await admin.post('/api/fs/move', { space: home, paths: ['/Notes.txt'], toPath: '/Docs', mode: 'move' });
  assert.deepEqual(mv.json.paths, ['/Docs/Notes.txt']);
  const into = await admin.post('/api/fs/move', { space: home, paths: ['/Docs'], toPath: '/Docs', mode: 'move' });
  assert.equal(into.status, 400, 'a folder cannot move into itself');
  const cp = await admin.post('/api/fs/move', { space: home, paths: ['/Trip'], toPath: '/Docs', mode: 'copy' });
  assert.deepEqual(cp.json.paths, ['/Docs/Trip']);

  const dl = await admin.get(`/api/fs/download?space=${home}&path=/Docs/Notes.txt`);
  assert.equal(dl.text, 'hello');
  assert.match(dl.headers.get('content-disposition')!, /attachment/);
  const zip = await admin.get(`/api/fs/zip?space=${home}&paths=${encodeURIComponent(JSON.stringify(['/Docs', '/notes (1).txt']))}`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');

  const search = await admin.get('/api/fs/search?q=note');
  assert.ok(search.json.results.some((r: { path: string }) => r.path === '/Docs/Notes.txt'));
});

test('uploaded HTML/SVG can never run script on the NAS origin', async () => {
  const { admin, adminId } = await fresh('xss');
  const home = `u:${adminId}`;
  await admin.upload(home, '/', [
    { name: 'evil.html', data: '<script>fetch("/api/admin/users")</script>' },
    { name: 'evil.svg', data: '<svg onload="alert(1)"/>' },
  ]);
  for (const f of ['evil.html', 'evil.svg']) {
    const r = await admin.get(`/api/fs/download?space=${home}&path=/${f}&inline=1`);
    assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(r.headers.get('content-security-policy')!, /sandbox/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('path traversal through the API is refused', async () => {
  const { admin, adminId } = await fresh('traversal');
  const home = `u:${adminId}`;
  for (const p of ['../../.homenas/homenas.db', '/../users', '/.homenas/volume.json', '..\\..\\x']) {
    const r = await admin.get(`/api/fs/download?space=${home}&path=${encodeURIComponent(p)}`);
    assert.ok([400, 403].includes(r.status), `${p} -> ${r.status}`);
  }
});

test('delete goes to trash; restore puts it back; purge removes it', async () => {
  const { srv, admin, adminId } = await fresh('trash');
  const home = `u:${adminId}`;
  await admin.upload(home, '/', [{ name: 'keep.txt', data: 'precious' }]);
  assert.equal((await admin.post('/api/fs/delete', { space: home, paths: ['/keep.txt'] })).status, 200);
  assert.ok(!fs.existsSync(path.join(srv.volume, 'users', 'ranjeet', 'keep.txt')));
  const trash = await admin.get('/api/trash');
  assert.equal(trash.json.items.length, 1);
  const id = trash.json.items[0].id;
  const restored = await admin.post('/api/trash/restore', { ids: [id] });
  assert.equal(restored.json.restored[0].path, '/keep.txt');
  assert.equal(fs.readFileSync(path.join(srv.volume, 'users', 'ranjeet', 'keep.txt'), 'utf8'), 'precious');

  await admin.post('/api/fs/delete', { space: home, paths: ['/keep.txt'] });
  const again = await admin.get('/api/trash');
  assert.equal((await admin.post('/api/trash/purge', { ids: [again.json.items[0].id] })).json.purged, 1);
  assert.equal((await admin.get('/api/trash')).json.items.length, 0);
});

test('overwrite keeps the old version in the trash', async () => {
  const { admin, adminId } = await fresh('overwrite');
  const home = `u:${adminId}`;
  await admin.upload(home, '/', [{ name: 'doc.txt', data: 'v1' }]);
  const fd = new FormData();
  fd.append('file', new Blob(['v2']), 'doc.txt');
  const r = await admin.req('POST', `/api/fs/upload?space=${home}&path=/&conflict=overwrite`, fd);
  assert.equal(r.json.results[0].status, 'replaced');
  assert.equal((await admin.get(`/api/fs/download?space=${home}&path=/doc.txt`)).text, 'v2');
  assert.equal((await admin.get('/api/trash')).json.items[0].name, 'doc.txt');
});

test('homes are private, even from admins; shared folders honour read/write', async () => {
  const { srv, admin, adminId } = await fresh('access');
  const { client: priya, id: priyaId } = await addUser(admin, srv.base, 'priya');
  const { client: guest, id: guestId } = await addUser(admin, srv.base, 'guest');

  await priya.upload(`u:${priyaId}`, '/', [{ name: 'diary.txt', data: 'secret' }]);
  assert.equal((await admin.get(`/api/fs/list?space=u:${priyaId}&path=/`)).status, 403, 'admin cannot browse a member home');
  assert.equal((await guest.get(`/api/fs/download?space=u:${priyaId}&path=/diary.txt`)).status, 403);

  const sp = await admin.post('/api/admin/spaces', {
    name: 'Family',
    members: [
      { userId: priyaId, access: 'write' },
      { userId: guestId, access: 'read' },
    ],
  });
  const family = sp.json.space.id;
  assert.equal((await priya.upload(family, '/', [{ name: 'recipe.txt', data: 'dal' }])).status, 200);
  assert.equal((await guest.get(`/api/fs/download?space=${family}&path=/recipe.txt`)).text, 'dal');
  assert.equal((await guest.upload(family, '/', [{ name: 'x.txt', data: 'x' }])).status, 403, 'read-only member cannot upload');
  assert.equal((await guest.post('/api/fs/delete', { space: family, paths: ['/recipe.txt'] })).status, 403);
  assert.equal((await guest.post('/api/shares', { space: family, path: '/recipe.txt' })).status, 403, 'read-only cannot publish links');
  assert.equal((await guest.get('/api/admin/users')).status, 403);

  const spaces = (await guest.get('/api/me')).json.spaces.map((s: { name: string }) => s.name);
  assert.deepEqual(spaces, ['My files', 'Family']);

  const del = await admin.del(`/api/admin/spaces/${sp.json.space.numericId}`);
  assert.equal(del.status, 409, 'non-empty shared folder cannot be deleted');
});

test('the last admin cannot be demoted or disabled', async () => {
  const { admin, adminId } = await fresh('lastadmin');
  assert.equal((await admin.patch(`/api/admin/users/${adminId}`, { role: 'member' })).status, 400);
  assert.equal((await admin.patch(`/api/admin/users/${adminId}`, { disabled: true })).status, 400);
});

test('share links: public access, confinement, password, expiry, revoke', async () => {
  const { srv, admin, adminId } = await fresh('shares');
  const home = `u:${adminId}`;
  await admin.upload(home, '/', [
    { name: 'a.txt', data: 'AAA', relpath: 'Public' },
    { name: 'secret.txt', data: 'nope' },
  ]);
  const link = (await admin.post('/api/shares', { space: home, path: '/Public' })).json.link;
  const token = link.url.split('/s/')[1];
  const anon = new Client(srv.base);
  anon.csrf = false;
  const meta = await anon.get(`/api/public/share/${token}`);
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.json.entries.map((e: { name: string }) => e.name), ['a.txt']);
  assert.equal((await anon.get(`/api/public/share/${token}/file?path=/a.txt`)).text, 'AAA');
  const escape = await anon.get(`/api/public/share/${token}/file?path=${encodeURIComponent('/../secret.txt')}`);
  assert.equal(escape.status, 403, 'cannot climb out of the shared folder');

  const locked = (await admin.post('/api/shares', { space: home, path: '/secret.txt', password: 'open sesame', expiresDays: 7 })).json.link;
  const lt = locked.url.split('/s/')[1];
  assert.equal((await anon.get(`/api/public/share/${lt}`)).json.needsPassword, true);
  assert.equal((await anon.get(`/api/public/share/${lt}/file`)).status, 401);
  assert.equal((await anon.post(`/api/public/share/${lt}/unlock`, { password: 'wrong' })).status, 401);
  assert.equal((await anon.post(`/api/public/share/${lt}/unlock`, { password: 'open sesame' })).status, 200);
  assert.equal((await anon.get(`/api/public/share/${lt}/file`)).text, 'nope');

  await admin.del(`/api/shares/${link.id}`);
  assert.equal((await anon.get(`/api/public/share/${token}`)).status, 404);

  // Renaming the shared folder keeps the link working.
  const l2 = (await admin.post('/api/shares', { space: home, path: '/Public' })).json.link;
  await admin.post('/api/fs/rename', { space: home, path: '/Public', name: 'Shared stuff' });
  assert.equal((await anon.get(`/api/public/share/${l2.url.split('/s/')[1]}/file?path=/a.txt`)).text, 'AAA');
});

test('phone backup: sync-state, upload, dedup, month folders, cursor, bad token', async () => {
  const { srv, admin } = await fresh('phone');
  const created = await admin.post('/api/devices', { name: "Ranjeet's iPhone", startFrom: 'everything' });
  assert.equal(created.status, 200, created.text);
  const token = created.json.token;
  assert.match(token, /^hn_/);
  const phone = new Client(srv.base);
  phone.csrf = false;

  // The QR pairing page hands the token to the phone without a login...
  const pairPath = new URL(created.json.pairUrl).pathname.replace('/pair/', '/api/pair/');
  const pair = await phone.get(pairPath);
  assert.equal(pair.json.token, token);
  assert.equal(pair.json.deviceName, "Ranjeet's iPhone");
  assert.equal((await phone.get('/api/pair/not-a-real-code')).status, 404);
  const auth = { authorization: `Bearer ${token}` };

  const state = await phone.req('GET', '/api/device/sync-state', undefined, auth);
  assert.equal(state.status, 200);
  assert.equal(state.json.since, '2000-01-01 00:00:00');

  const send = async (name: string, data: string, takenAt: string) => {
    const fd = new FormData();
    fd.append('file', new Blob([data], { type: 'image/heic' }), name);
    fd.append('takenAt', takenAt); // after the file, like a Shortcut form can do
    return phone.req('POST', '/api/device/upload', fd, auth);
  };
  const a = await send('IMG_0001.HEIC', 'photo-one', '2026-08-31T23:50:00+05:30');
  assert.equal(a.json.status, 'stored', a.text);
  assert.equal(a.json.path, "/Phone Backup/Ranjeet's iPhone/2026/08/IMG_0001.HEIC");
  const b = await send('IMG_0002.HEIC', 'photo-two', '2026-09-01T00:30:00+05:30');
  assert.equal(b.json.path, "/Phone Backup/Ranjeet's iPhone/2026/09/IMG_0002.HEIC", 'month follows the phone clock');
  const again = await send('IMG_0001.HEIC', 'photo-one', '2026-08-31T23:50:00+05:30');
  assert.equal(again.json.status, 'duplicate');
  // iPhones reuse IMG_ numbers after 9999: same name, different photo, same month.
  const c = await send('IMG_0002.HEIC', 'different-photo', '2026-09-02T09:00:00+05:30');
  assert.equal(c.json.path, "/Phone Backup/Ranjeet's iPhone/2026/09/IMG_0002 (1).HEIC");

  const disk = path.join(srv.volume, 'users', 'ranjeet', 'Phone Backup', "Ranjeet's iPhone", '2026', '08', 'IMG_0001.HEIC');
  assert.equal(fs.readFileSync(disk, 'utf8'), 'photo-one');
  assert.equal(fs.statSync(disk).mtime.toISOString(), '2026-08-31T18:20:00.000Z', 'file date = when the photo was taken');

  const done = await phone.req('POST', '/api/device/sync-complete', undefined, auth);
  assert.equal(done.json.stored, 3);
  assert.equal(done.json.skipped, 1);
  assert.equal(done.json.outOfOrder, true, 'the duplicate was re-sent out of order');
  assert.match(done.json.message, /Oldest First/);

  // A clean oldest-first run moves the cursor and the next sync-state starts just before it.
  await phone.req('GET', '/api/device/sync-state', undefined, auth);
  await send('IMG_0010.HEIC', 'p10', '2026-09-03T10:00:00+05:30');
  await send('IMG_0011.HEIC', 'p11', '2026-09-03T11:00:00+05:30');
  const ok = await phone.req('POST', '/api/device/sync-complete', undefined, auth);
  assert.equal(ok.json.outOfOrder, false);
  assert.equal(ok.json.backedUpThrough, '2026-09-03T05:30:00.000Z');
  const next = await phone.req('GET', '/api/device/sync-state', undefined, auth);
  assert.equal(next.json.since, '2026-09-03 10:59:55');

  const devices = await admin.get('/api/devices');
  assert.equal(devices.json.devices[0].totalFiles, 5);
  assert.equal(devices.json.devices[0].orderWarning, false);

  const bad = await phone.req('GET', '/api/device/sync-state', undefined, { authorization: 'Bearer hn_wrong' });
  assert.equal(bad.status, 401);

  // Rotating the token locks out the old one, and the old pairing link with it.
  const rotated = await admin.post(`/api/devices/${created.json.device.id}/token`);
  assert.equal((await phone.req('GET', '/api/device/sync-state', undefined, auth)).status, 401);
  assert.equal((await phone.get(pairPath)).status, 404);
  const newPair = await phone.get(new URL(rotated.json.pairUrl).pathname.replace('/pair/', '/api/pair/'));
  assert.equal(newPair.json.token, rotated.json.token);
});

test('unplugging the drive takes the NAS offline; plugging it back brings it online', async () => {
  const { srv, admin } = await fresh('offline');
  const marker = path.join(srv.volume, '.homenas', 'volume.json');
  const saved = fs.readFileSync(marker);
  fs.rmSync(marker);
  srv.rt.checkVolume();
  srv.rt.checkVolume(); // two misses in a row
  assert.equal(srv.rt.state, 'offline');
  assert.equal((await admin.get('/api/me')).status, 503);
  assert.equal((await admin.get('/api/status')).json.state, 'offline');
  fs.writeFileSync(marker, saved);
  srv.rt.checkVolume();
  assert.equal(srv.rt.state, 'online');
  assert.equal((await admin.get('/api/me')).status, 200, 'sessions survive because they live on the drive');
});
