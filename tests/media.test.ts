import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { Client, setupWithAdmin, startServer, type TestServer } from './helpers.ts';

const servers: TestServer[] = [];
after(async () => {
  for (const s of servers) await s.close();
});

async function makeJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro' },
      IFD2: { DateTimeOriginal: '2026:09:20 10:15:00', OffsetTimeOriginal: '+05:30' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 58/1 1800/100', GPSLongitudeRef: 'E', GPSLongitude: '77/1 35/1 4000/100' },
    })
    .toBuffer();
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;

test('photo: EXIF date with offset, camera, GPS, thumbnail, preview, timeline', async () => {
  const { srv, admin, adminId } = await setupWithAdmin('media-photo');
  servers.push(srv);
  const home = `u:${adminId}`;
  const up = await admin.upload(home, '/', [{ name: 'beach.jpg', data: await makeJpeg() }]);
  assert.equal(up.status, 200, up.text);

  const list = await admin.get(`/api/fs/list?space=${home}&path=/`);
  const entry = list.json.entries.find((e: { name: string }) => e.name === 'beach.jpg');
  assert.ok(entry.id && entry.thumb);

  const thumb = await admin.get(`/api/media/${entry.id}/thumb`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get('content-type'), 'image/webp');
  assert.match(thumb.headers.get('cache-control')!, /immutable/);

  const info = await admin.get(`/api/media/${entry.id}`);
  assert.equal(info.json.takenAt, '2026-09-20T04:45:00.000Z', '10:15 at +05:30');
  assert.equal(info.json.camera, 'iPhone 15 Pro');
  assert.equal(info.json.width, 1200);
  assert.ok(Math.abs(info.json.lat - 12.97167) < 0.001, `lat ${info.json.lat}`);
  assert.ok(Math.abs(info.json.lon - 77.59444) < 0.001, `lon ${info.json.lon}`);

  const preview = await admin.get(`/api/media/${entry.id}/preview`);
  assert.equal(preview.headers.get('content-type'), 'image/jpeg', 'browser-native formats are served as-is');

  const photos = await admin.get('/api/photos');
  assert.equal(photos.json.items.length, 1);
  assert.equal(photos.json.items[0].takenAt, '2026-09-20T04:45:00.000Z');

  // A second copy under another name is recognised by content hash.
  await admin.upload(home, '/', [{ name: 'copy.jpg', data: await makeJpeg() }]);
  const rows = srv.rt.db!.prepare(`SELECT sha256 FROM files WHERE kind = 'image'`).all() as { sha256: string }[];
  assert.equal(new Set(rows.map((r) => r.sha256)).size, 1);
});

test('thumbnails survive the cache being wiped', async () => {
  const { srv, admin, adminId } = await setupWithAdmin('media-rebuild');
  servers.push(srv);
  await admin.upload(`u:${adminId}`, '/', [{ name: 'p.jpg', data: await makeJpeg() }]);
  const id = (await admin.get(`/api/fs/list?space=u:${adminId}&path=/`)).json.entries[0].id;
  assert.equal((await admin.get(`/api/media/${id}/thumb`)).status, 200);
  fs.rmSync(path.join(srv.volume, '.homenas', 'thumbs'), { recursive: true, force: true });
  assert.equal((await admin.get(`/api/media/${id}/thumb`)).status, 200);
});

test('video: poster frame, duration and creation date via ffmpeg', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { srv, admin, adminId } = await setupWithAdmin('media-video');
  servers.push(srv);
  const clip = path.join(srv.dir, 'clip.mp4');
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', '-pix_fmt', 'yuv420p', '-metadata', 'creation_time=2026-09-21T06:00:00Z', clip],
    { windowsHide: true },
  );
  assert.equal(r.status, 0, r.stderr?.toString());
  await admin.upload(`u:${adminId}`, '/', [{ name: 'clip.mp4', data: fs.readFileSync(clip) }]);
  const entry = (await admin.get(`/api/fs/list?space=u:${adminId}&path=/`)).json.entries.find((e: { name: string }) => e.name === 'clip.mp4');
  const thumb = await admin.get(`/api/media/${entry.id}/thumb`);
  assert.equal(thumb.status, 200);
  const info = await admin.get(`/api/media/${entry.id}`);
  assert.equal(info.json.takenAt, '2026-09-21T06:00:00.000Z');
  assert.equal(info.json.width, 320);
  assert.ok(Math.abs(info.json.duration - 2) < 0.2);
  const ranged = await admin.req('GET', `/api/media/${entry.id}/file`, undefined, { range: 'bytes=0-99' });
  assert.equal(ranged.status, 206, 'video seeking needs HTTP range support');
});

test('background workers make thumbnails on their own and never block the server', async () => {
  const { srv, admin, adminId } = await setupWithAdmin('media-background', { background: true });
  servers.push(srv);
  await admin.upload(`u:${adminId}`, '/', [
    { name: 'a.jpg', data: await makeJpeg() },
    { name: 'notes.txt', data: 'not media' },
  ]);
  const deadline = Date.now() + 15_000;
  let pending = -1;
  while (Date.now() < deadline) {
    // Every poll must answer quickly: a blocked event loop would time this out.
    const sys = await Promise.race([
      admin.get('/api/admin/system'),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('server stopped responding')), 3000)),
    ]);
    pending = sys.json.index.mediaPending;
    if (pending === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(pending, 0, 'thumbnail queue drained by the background workers');
  const row = srv.rt.db!.prepare(`SELECT media_state, sha256 FROM files WHERE name = 'a.jpg'`).get() as { media_state: string; sha256: string };
  assert.equal(row.media_state, 'done');
  assert.ok(fs.existsSync(path.join(srv.volume, '.homenas', 'thumbs', row.sha256.slice(0, 2), `${row.sha256}.webp`)));
});

test('thumbnails work beyond the 260-character Windows path limit', async () => {
  const { srv, admin, adminId } = await setupWithAdmin('media-longpath');
  servers.push(srv);
  const home = `u:${adminId}`;
  // The NAS root stays short (SQLite needs that); the user's own folders nest deep, as real ones do.
  const a = 'Holiday photos from the long trip to the mountains and the coast in the summer'.slice(0, 80);
  const b = 'Day three - the drive back through the valley with everyone asleep in the car';
  await admin.post('/api/fs/mkdir', { space: home, path: '/', name: a });
  await admin.post('/api/fs/mkdir', { space: home, path: '/' + a, name: b });
  const folder = `/${a}/${b}`;
  await admin.upload(home, folder, [{ name: 'IMG_0001 with a fairly long descriptive file name for testing.jpg', data: await makeJpeg() }]);
  const entry = (await admin.get(`/api/fs/list?space=${home}&path=${encodeURIComponent(folder)}`)).json.entries[0];
  const abs = path.join(srv.volume, 'users', 'ranjeet', a, b, entry.name);
  assert.ok(abs.length > 260, `the test path really is long (${abs.length})`);
  const thumb = await admin.get(`/api/media/${entry.id}/thumb`);
  assert.equal(thumb.status, 200, thumb.text);
  assert.equal((await admin.get(`/api/media/${entry.id}`)).json.width, 1200);
});

test('setup refuses a storage root too long for the database', async () => {
  const srv = await startServer('media-longroot');
  servers.push(srv);
  const c = new Client(srv.base);
  const r = await c.post('/api/setup/inspect', { path: path.join(srv.dir, 'z'.repeat(190)) });
  assert.match(r.json.problems[0], /too long/);
});

test('files copied onto the drive outside HomeNAS appear by themselves', async () => {
  const { srv, admin } = await setupWithAdmin('media-watch', { background: true });
  servers.push(srv);
  const outside = path.join(srv.volume, 'users', 'ranjeet', 'Copied in Explorer');
  await new Promise((r) => setTimeout(r, 300)); // let the watcher attach
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'IMG_9000.jpg'), await makeJpeg());
  const deadline = Date.now() + 10_000;
  let found = false;
  while (!found && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    found = (await admin.get('/api/photos')).json.items.some((p: { name: string }) => p.name === 'IMG_9000.jpg');
  }
  assert.ok(found, 'the new photo reached the timeline without browsing to it or waiting for a scan');
});

test('HEIC: a missing or failing native decoder falls back instead of losing the thumbnail', async () => {
  const { srv, admin, adminId } = await setupWithAdmin('media-heif-fallback');
  servers.push(srv);
  srv.rt.tools.heifDec = 'no-such-heif-decoder'; // what a Pi without libheif-examples, or a broken one, looks like
  // Some cameras save AVIF/JPEG data with a .heic name; the chain must still end in a thumbnail.
  await admin.upload(`u:${adminId}`, '/', [{ name: 'IMG_0001.HEIC', data: await makeJpeg() }]);
  const entry = (await admin.get(`/api/fs/list?space=u:${adminId}&path=/`)).json.entries[0];
  const thumb = await admin.get(`/api/media/${entry.id}/thumb`);
  assert.equal(thumb.status, 200, thumb.text);
  assert.equal((await admin.get(`/api/media/${entry.id}/preview`)).headers.get('content-type'), 'image/webp');
});
