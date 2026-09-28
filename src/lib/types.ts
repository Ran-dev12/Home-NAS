export type Role = 'admin' | 'member';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface Status {
  state: 'setup' | 'offline' | 'online';
  version: string;
  serverName: string;
  user: User | null;
  offlineReason?: string;
  storageRoot?: string | null;
  needsSetupCode?: boolean;
}

export interface Space {
  id: string;
  kind: 'home' | 'shared';
  name: string;
  access: 'read' | 'write';
}

export interface Entry {
  id: number | null;
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  kind: 'folder' | 'image' | 'video' | 'audio' | 'document' | 'text' | 'archive' | 'other';
  takenAt: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb: boolean;
}

export interface Listing {
  space: Space;
  path: string;
  entries: Entry[];
}

export interface Photo {
  id: number;
  space: string;
  path: string;
  name: string;
  kind: 'image' | 'video';
  ts: number;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  size: number;
  mtime: number;
}

export interface MediaInfo extends Omit<Photo, 'ts'> {
  lat: number | null;
  lon: number | null;
  camera: string | null;
}

export interface Device {
  id: number;
  userId: number;
  owner?: string | null;
  name: string;
  folder: string;
  tokenHint: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  backedUpThrough: string | null;
  batchLimit: number;
  lastRun: { stored: number; skipped: number; excluded: number; bytes: number; startedAt: string | null };
  totalFiles: number;
  totalBytes: number;
  orderWarning: boolean;
  backup: BackupChoice;
  /** Date Taken (UTC ISO) of items the phone could not read, skipped so later backups get through. */
  unreadable?: string[];
}

/** What a phone backs up. Photos, videos and screenshots come from the Photos app; files from the Files app. */
export interface BackupChoice {
  photos: boolean;
  videos: boolean;
  screenshots: boolean;
  files: boolean;
}

export interface DeviceSecret {
  device: Device;
  token: string;
  baseUrl: string;
  candidates: string[];
  pairUrl: string;
  pairExpiresAt: string;
}

export interface ShareLink {
  id: number;
  url: string;
  space: string;
  spaceName?: string;
  path: string;
  name: string;
  isDir: boolean;
  createdAt: string;
  expiresAt: string | null;
  hasPassword: boolean;
  views: number;
  downloads: number;
  active: boolean;
}

export interface TrashItem {
  id: string;
  space: string;
  spaceName: string;
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  deletedAt: string;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
  disabled: boolean;
  usedBytes: number;
  files: number;
  lastSeenAt: string | null;
  devices: number;
}

export interface AdminSpace {
  id: string;
  numericId: number;
  name: string;
  folder: string;
  createdAt: string;
  usedBytes: number;
  files: number;
  members: { userId: number; access: 'read' | 'write'; displayName: string; username: string }[];
}

export interface Settings {
  serverName: string;
  publicUrl: string;
  trashDays: number;
  maxUploadGb: number;
  minFreeGb: number;
  scanMinutes: number;
}

export interface SystemInfo {
  volume: { root: string; name?: string; id?: string; createdAt?: string; disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null };
  index: {
    files: number;
    folders: number;
    photos: number;
    videos: number;
    bytes: number;
    mediaPending: number;
    mediaErrors: number;
    scanning: boolean;
    scanProgress: { files: number };
    lastScan: { at: string; files: number; ms: number; errors: number } | null;
  };
  trash: { items: number; bytes: number };
  server: {
    hostname: string;
    platform: string;
    node: string;
    uptimeSec: number;
    port: number;
    lan: { name: string; address: string; kind: string }[];
    ffmpeg: boolean;
    ffprobe: boolean;
  };
}

export interface ActivityRow {
  id: number;
  at: string;
  user_id: number | null;
  device_id: number | null;
  action: string;
  space: string | null;
  path: string | null;
  detail: string | null;
  who: string | null;
  device: string | null;
}
