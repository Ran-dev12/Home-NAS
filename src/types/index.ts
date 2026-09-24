export interface Device {
  id: string;
  name: string;
  model: string;
  owner: string;
  color: string;
  token: string;
  ipAddress?: string;
  lastSyncAt: string | null;
  totalPhotosSynced: number;
  totalVideosSynced: number;
  totalBytesSynced: number;
  status: 'idle' | 'syncing' | 'offline';
  syncSchedule: {
    enabled: boolean;
    triggerType: 'wifi_connect' | 'charging' | 'daily' | 'interval';
    wifiSsid: string;
    dailyTime?: string; // e.g. "02:00"
    intervalMinutes?: number; // e.g. 180
    onlyOnWifi: boolean;
    onlyWhileCharging: boolean;
  };
}

export interface PhotoRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  filename: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  fileHash: string; // SHA-256 for deduplication
  takenAt: string;
  syncedAt: string;
  mediaType: 'photo' | 'video' | 'live_photo' | 'screenshot';
  relativeSsdPath: string; // e.g. "iPhone_15_Pro/2026/09/IMG_20260924_1052.heic"
  absoluteSsdPath: string;
  exif?: {
    cameraModel?: string;
    lens?: string;
    iso?: number;
    aperture?: string;
    shutterSpeed?: string;
    focalLength?: string;
    dimensions?: { width: number; height: number };
    location?: { latitude: number; longitude: number; city?: string };
  };
  isFavorite?: boolean;
}

export interface StorageConfig {
  ssdMountPath: string;
  ssdLabel: string;
  folderNamingPattern: 'year_month' | 'device_year_month' | 'flat_timeline';
  deduplicationEnabled: boolean;
  preserveLivePhotos: boolean;
  homeWifiSsid: string;
  pcLocalIp: string;
  serverPort: number;
  autoPruneTempFiles: boolean;
}

export interface StorageStats {
  totalCapacityBytes: number;
  freeSpaceBytes: number;
  usedSpaceBytes: number;
  localVaultBytes: number;
  totalPhotos: number;
  totalVideos: number;
  totalDuplicatesSavedBytes: number;
  totalDuplicatesSkipped: number;
}

export interface SyncLogEvent {
  id: string;
  timestamp: string;
  deviceId: string;
  deviceName: string;
  level: 'info' | 'success' | 'warning' | 'error';
  trigger: 'shortcut' | 'web_auto' | 'manual' | 'scheduled';
  message: string;
  itemsProcessed?: number;
  bytesTransferred?: number;
  durationMs?: number;
}
