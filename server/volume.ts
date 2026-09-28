import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const SYS_DIR = '.homenas';

export interface VolumeMarker {
  id: string;
  name: string;
  createdAt: string;
  version: 1;
}

export function volumePaths(root: string) {
  const sys = path.join(root, SYS_DIR);
  return {
    sys,
    marker: path.join(sys, 'volume.json'),
    db: path.join(sys, 'homenas.db'),
    thumbs: path.join(sys, 'thumbs'),
    previews: path.join(sys, 'previews'),
    trash: path.join(sys, 'trash'),
    tmp: path.join(sys, 'tmp'),
    users: path.join(root, 'users'),
    shared: path.join(root, 'shared'),
  };
}

/**
 * The marker is how we know the SSD is really attached. Without it the server refuses to touch the path,
 * so an unplugged drive can never silently turn into a folder on the internal disk.
 */
export function readMarker(root: string): VolumeMarker | null {
  try {
    const m = JSON.parse(fs.readFileSync(volumePaths(root).marker, 'utf8'));
    if (m && typeof m.id === 'string') return m as VolumeMarker;
  } catch {
    /* missing or unreadable = offline */
  }
  return null;
}

export function initVolume(root: string, name: string): VolumeMarker {
  if (!fs.existsSync(root)) throw new Error(`Folder does not exist: ${root}`);
  const p = volumePaths(root);
  for (const dir of [p.sys, p.thumbs, p.previews, p.trash, p.tmp, p.users, p.shared]) fs.mkdirSync(dir, { recursive: true });
  const marker: VolumeMarker = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), version: 1 };
  fs.writeFileSync(p.marker, JSON.stringify(marker, null, 2));
  fs.writeFileSync(
    path.join(p.sys, 'README.txt'),
    'HomeNAS system data: database, thumbnails, trash and upload temp files.\r\nDo not edit or delete this folder while HomeNAS is running.\r\n',
  );
  return marker;
}

export function ensureVolumeDirs(root: string) {
  const p = volumePaths(root);
  for (const dir of [p.thumbs, p.previews, p.trash, p.tmp, p.users, p.shared]) fs.mkdirSync(dir, { recursive: true });
}

export interface DiskStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export function diskStats(p: string): DiskStats | null {
  try {
    const s = fs.statfsSync(p);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { totalBytes: total, freeBytes: free, usedBytes: total - s.bfree * s.bsize };
  } catch {
    return null;
  }
}

export type DriveKind = 'local' | 'removable' | 'network' | 'other';

export interface DriveInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  isSystem: boolean;
  kind: DriveKind;
  label: string;
  fileSystem: string;
  /** For network drives: the \\server\share it maps to. */
  provider?: string;
}

interface WinDrive {
  kind: DriveKind;
  label: string;
  fileSystem: string;
  provider?: string;
}

let winCache: { at: number; map: Map<string, WinDrive> } | null = null;

/**
 * Ask Windows what each drive letter really is. Mapped network shares look like ordinary letters, but a
 * SQLite database on SMB can corrupt, and the "drive" vanishes with the network, so they are refused.
 */
export function windowsDrives(): Map<string, WinDrive> | null {
  if (process.platform !== 'win32') return null;
  if (winCache && Date.now() - winCache.at < 30_000) return winCache.map;
  try {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,FileSystem,ProviderName | ConvertTo-Json -Compress'],
      { windowsHide: true, timeout: 20_000, encoding: 'utf8' },
    );
    if (r.status !== 0 || !r.stdout.trim()) return null;
    const raw = JSON.parse(r.stdout);
    const list = (Array.isArray(raw) ? raw : [raw]) as { DeviceID: string; DriveType: number; VolumeName: string | null; FileSystem: string | null; ProviderName: string | null }[];
    const map = new Map<string, WinDrive>();
    for (const d of list) {
      const kind: DriveKind = d.DriveType === 3 ? 'local' : d.DriveType === 2 ? 'removable' : d.DriveType === 4 ? 'network' : 'other';
      map.set(d.DeviceID.toUpperCase(), { kind, label: d.VolumeName ?? '', fileSystem: d.FileSystem ?? '', provider: d.ProviderName ?? undefined });
    }
    winCache = { at: Date.now(), map };
    return map;
  } catch {
    return null;
  }
}

// ---- Linux (Raspberry Pi): drives are mount points ------------------------------------------------------

export interface MountEntry {
  device: string;
  mountPoint: string;
  fsType: string;
}

const NETWORK_FS = new Set(['cifs', 'smb3', 'smbfs', 'nfs', 'nfs4', 'sshfs', '9p', 'afs', 'ceph', 'glusterfs', 'davfs']);
const DISK_FS = new Set(['ext4', 'ext3', 'ext2', 'xfs', 'btrfs', 'f2fs', 'exfat', 'vfat', 'ntfs', 'ntfs3', 'fuseblk', 'hfsplus', 'apfs', 'zfs']);

/** Parse /proc/mounts. Mount points with spaces come escaped as \040. */
export function parseMounts(text: string): MountEntry[] {
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
  return text
    .split('\n')
    .map((line) => line.split(' '))
    .filter((f) => f.length >= 3 && f[1].startsWith('/'))
    .map(([device, mountPoint, fsType]) => ({ device: unescape(device), mountPoint: unescape(mountPoint), fsType }));
}

/** The mount holding `p`: the longest matching mount point (later entries win, as they shadow earlier ones). */
export function mountFor(p: string, mounts: MountEntry[]): MountEntry | null {
  let best: MountEntry | null = null;
  for (const m of mounts) {
    const mp = m.mountPoint;
    const inside = mp === '/' || p === mp || p.startsWith(mp + '/');
    if (inside && (!best || mp.length >= best.mountPoint.length)) best = m;
  }
  return best;
}

export function fsKind(fsType: string): DriveKind {
  if (NETWORK_FS.has(fsType) || (fsType.startsWith('fuse.') && fsType !== 'fuseblk')) return 'network';
  return DISK_FS.has(fsType) ? 'local' : 'other';
}

/** Friendly names, and the same labels Windows uses so one set of checks (FAT32, exFAT) covers both. */
export function fsLabel(fsType: string): string {
  return ({ vfat: 'FAT32', exfat: 'exFAT', ntfs: 'NTFS', ntfs3: 'NTFS', fuseblk: 'NTFS/exFAT', ext4: 'ext4', btrfs: 'Btrfs', xfs: 'XFS' } as Record<string, string>)[fsType] ?? fsType;
}

function linuxMounts(): MountEntry[] | null {
  if (process.platform !== 'linux') return null;
  try {
    return parseMounts(fs.readFileSync('/proc/mounts', 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve symlinks on the part of the path that exists, so /home/pi/nas -> /mnt/ssd/nas is judged correctly. */
function realExisting(p: string): string {
  let probe = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(probe)) {
    const up = path.dirname(probe);
    if (up === probe) break;
    rest.unshift(path.basename(probe));
    probe = up;
  }
  try {
    return path.join(fs.realpathSync(probe), ...rest);
  } catch {
    return path.resolve(p);
  }
}

export interface DriveFacts extends WinDrive {
  /** The OS disk: C: on Windows, the SD card (/) on a Pi. */
  isSystem: boolean;
}

/** What kind of drive a path is on, on Windows or Linux. Null when it cannot be told. */
export function driveOf(p: string): DriveFacts | null {
  if (process.platform === 'win32') {
    const letter = /^([A-Za-z]:)/.exec(p)?.[1]?.toUpperCase();
    const w = letter ? windowsDrives()?.get(letter) : undefined;
    if (!w || !letter) return null;
    return { ...w, isSystem: letter === (process.env.SystemDrive || 'C:').toUpperCase() };
  }
  const mounts = linuxMounts();
  const m = mounts ? mountFor(realExisting(p), mounts) : null;
  if (!m) return null;
  const kind = fsKind(m.fsType);
  return { kind, label: m.mountPoint, fileSystem: fsLabel(m.fsType), provider: kind === 'network' ? m.device : undefined, isSystem: m.mountPoint === '/' };
}

/** Drives worth offering in the setup wizard on Linux: real disks and (refused) network mounts. */
export function linuxDriveList(mounts: MountEntry[], stat: (p: string) => DiskStats | null = diskStats): DriveInfo[] {
  const byMount = new Map<string, MountEntry>();
  for (const m of mounts) byMount.set(m.mountPoint, m); // later mounts shadow earlier ones
  const out: DriveInfo[] = [];
  for (const m of byMount.values()) {
    const kind = fsKind(m.fsType);
    if (kind === 'other') continue;
    if (kind === 'local' && !m.device.startsWith('/dev/')) continue;
    if (/^\/(boot|snap|var\/snap|run\/user|efi)(\/|$)/.test(m.mountPoint)) continue;
    const st = kind === 'network' ? { totalBytes: 0, freeBytes: 0, usedBytes: 0 } : stat(m.mountPoint);
    if (!st) continue;
    out.push({
      path: m.mountPoint,
      totalBytes: st.totalBytes,
      freeBytes: st.freeBytes,
      isSystem: m.mountPoint === '/',
      kind,
      label: m.mountPoint === '/' ? 'System disk (SD card)' : path.basename(m.mountPoint),
      fileSystem: fsLabel(m.fsType),
      provider: kind === 'network' ? m.device : undefined,
    });
  }
  return out;
}

export function listDrives(): DriveInfo[] {
  const out: DriveInfo[] = [];
  if (process.platform === 'win32') {
    const sysDrive = (process.env.SystemDrive || 'C:').toUpperCase();
    const win = windowsDrives();
    const letters = win ? [...win.keys()] : Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ':');
    for (const letter of letters) {
      const root = letter + path.sep;
      const w = win?.get(letter);
      if (w?.kind === 'other') continue; // CD/DVD and the like
      // Never stat a network share here: a disconnected one can hang for many seconds.
      const st = w?.kind === 'network' ? { totalBytes: 0, freeBytes: 0 } : diskStats(root);
      if (!st) continue;
      out.push({
        path: root,
        totalBytes: st.totalBytes,
        freeBytes: st.freeBytes,
        isSystem: root.toUpperCase().startsWith(sysDrive),
        kind: w?.kind ?? 'local',
        label: w?.label ?? '',
        fileSystem: w?.fileSystem ?? '',
        provider: w?.provider,
      });
    }
  } else if (linuxMounts()) {
    out.push(...linuxDriveList(linuxMounts()!));
  } else {
    const candidates = new Set<string>(['/', os.homedir()]);
    for (const base of ['/Volumes', '/media', '/mnt', `/media/${os.userInfo().username}`]) {
      try {
        for (const d of fs.readdirSync(base)) candidates.add(path.join(base, d));
      } catch {
        /* ignore */
      }
    }
    for (const c of candidates) {
      const st = diskStats(c);
      if (st) out.push({ path: c, totalBytes: st.totalBytes, freeBytes: st.freeBytes, isSystem: c === '/', kind: 'local', label: '', fileSystem: '' });
    }
  }
  return out;
}
