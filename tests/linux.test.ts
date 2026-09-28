import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fsKind, fsLabel, linuxDriveList, mountFor, parseMounts } from '../server/volume.ts';

// A Raspberry Pi 5: OS on the SD card, the NAS SSD at /mnt/ssd, a desktop-automounted USB disk,
// a FAT32 stick, and two network mounts that must never be offered as storage.
const PI_MOUNTS = `/dev/mmcblk0p2 / ext4 rw,noatime 0 0
devtmpfs /dev devtmpfs rw,relatime 0 0
proc /proc proc rw,relatime 0 0
tmpfs /run tmpfs rw,nosuid 0 0
/dev/mmcblk0p1 /boot/firmware vfat rw,relatime 0 0
/dev/sda1 /mnt/ssd ext4 rw,noatime 0 0
/dev/sdb1 /media/pi/My\\040Passport exfat rw,relatime 0 0
/dev/sdc1 /mnt/usbstick vfat rw,relatime 0 0
//fileserver/photos /mnt/old-nas cifs rw,relatime 0 0
nas:/export /mnt/nfs nfs4 rw,relatime 0 0
pi@laptop:/home /mnt/laptop fuse.sshfs rw 0 0
`;

const mounts = parseMounts(PI_MOUNTS);

test('parseMounts decodes escaped spaces', () => {
  assert.ok(mounts.some((m) => m.mountPoint === '/media/pi/My Passport' && m.fsType === 'exfat'));
});

test('mountFor picks the longest matching mount point, not a name prefix', () => {
  assert.equal(mountFor('/mnt/ssd/HomeNAS', mounts)?.device, '/dev/sda1');
  assert.equal(mountFor('/mnt/ssd', mounts)?.device, '/dev/sda1');
  assert.equal(mountFor('/mnt/ssdx/HomeNAS', mounts)?.mountPoint, '/', '/mnt/ssdx is not inside /mnt/ssd');
  assert.equal(mountFor('/home/pi/nas', mounts)?.mountPoint, '/', 'a home folder lives on the SD card');
  assert.equal(mountFor('/media/pi/My Passport/HomeNAS', mounts)?.device, '/dev/sdb1');
});

test('network filesystems are recognised', () => {
  for (const t of ['cifs', 'nfs4', 'nfs', 'fuse.sshfs', 'smb3']) assert.equal(fsKind(t), 'network', t);
  for (const t of ['ext4', 'exfat', 'vfat', 'fuseblk', 'ntfs3']) assert.equal(fsKind(t), 'local', t);
  for (const t of ['tmpfs', 'proc', 'devtmpfs']) assert.equal(fsKind(t), 'other', t);
  assert.equal(fsLabel('vfat'), 'FAT32', 'same label Windows uses, so the 4 GB warning fires on both');
});

test('the setup wizard lists real disks, flags network mounts, hides system internals', () => {
  const fakeStat = () => ({ totalBytes: 1e12, freeBytes: 5e11, usedBytes: 5e11 });
  const list = linuxDriveList(mounts, fakeStat);
  const byPath = new Map(list.map((d) => [d.path, d]));
  assert.deepEqual([...byPath.keys()].sort(), ['/', '/media/pi/My Passport', '/mnt/laptop', '/mnt/nfs', '/mnt/old-nas', '/mnt/ssd', '/mnt/usbstick']);
  assert.equal(byPath.get('/')?.isSystem, true);
  assert.equal(byPath.get('/')?.label, 'System disk (SD card)');
  assert.equal(byPath.get('/mnt/ssd')?.kind, 'local');
  assert.equal(byPath.get('/mnt/usbstick')?.fileSystem, 'FAT32');
  assert.equal(byPath.get('/mnt/old-nas')?.kind, 'network');
  assert.equal(byPath.get('/mnt/old-nas')?.provider, '//fileserver/photos');
  assert.ok(!byPath.has('/boot/firmware'));
});
