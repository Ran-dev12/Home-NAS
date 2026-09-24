import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';
import type { Device, PhotoRecord, StorageConfig, StorageStats, SyncLogEvent } from './src/types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Set up JSON & urlencoded parsing
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Base data directories
const DATA_DIR = path.resolve(__dirname, 'storage');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DEFAULT_SSD_PATH = path.join(DATA_DIR, 'ssd_external_vault');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DEFAULT_SSD_PATH)) {
  fs.mkdirSync(DEFAULT_SSD_PATH, { recursive: true });
}

// In-memory + persistent database store
interface LocalVaultDb {
  config: StorageConfig;
  devices: Device[];
  photos: PhotoRecord[];
  logs: SyncLogEvent[];
  stats: StorageStats;
}

// Get LAN IP
function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netFace = interfaces[name];
    if (netFace) {
      for (const info of netFace) {
        if (info.family === 'IPv4' && !info.internal) {
          return info.address;
        }
      }
    }
  }
  return '192.168.1.105'; // Fallback realistic LAN IP
}

const defaultIp = getLocalIp();

const initialDb: LocalVaultDb = {
  config: {
    ssdMountPath: process.platform === 'win32' ? 'D:\\Photos_SSD_Vault' : DEFAULT_SSD_PATH,
    ssdLabel: 'Samsung T7 Shield 2TB (External SSD)',
    folderNamingPattern: 'device_year_month',
    deduplicationEnabled: true,
    preserveLivePhotos: true,
    homeWifiSsid: 'Home_WiFi_5GHz',
    pcLocalIp: defaultIp,
    serverPort: PORT,
    autoPruneTempFiles: true,
  },
  devices: [
    {
      id: 'iphone-1',
      name: "Ranjeet's iPhone 15 Pro",
      model: 'iPhone 15 Pro Max',
      owner: 'Ranjeet',
      color: '#0284c7', // Sky blue
      token: 'tok_' + crypto.randomBytes(8).toString('hex'),
      ipAddress: '192.168.1.45',
      lastSyncAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      totalPhotosSynced: 1248,
      totalVideosSynced: 84,
      totalBytesSynced: 4850000000,
      status: 'idle',
      syncSchedule: {
        enabled: true,
        triggerType: 'charging',
        wifiSsid: 'Home_WiFi_5GHz',
        dailyTime: '02:30',
        intervalMinutes: 180,
        onlyOnWifi: true,
        onlyWhileCharging: true,
      },
    },
    {
      id: 'iphone-2',
      name: 'Family iPhone 14',
      model: 'iPhone 14 Plus',
      owner: 'Family',
      color: '#8b5cf6', // Violet
      token: 'tok_' + crypto.randomBytes(8).toString('hex'),
      ipAddress: '192.168.1.52',
      lastSyncAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      totalPhotosSynced: 932,
      totalVideosSynced: 42,
      totalBytesSynced: 3120000000,
      status: 'idle',
      syncSchedule: {
        enabled: true,
        triggerType: 'wifi_connect',
        wifiSsid: 'Home_WiFi_5GHz',
        dailyTime: '03:00',
        intervalMinutes: 240,
        onlyOnWifi: true,
        onlyWhileCharging: false,
      },
    },
  ],
  photos: [],
  logs: [
    {
      id: 'log-1',
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      deviceId: 'iphone-1',
      deviceName: "Ranjeet's iPhone 15 Pro",
      level: 'success',
      trigger: 'shortcut',
      message: 'Automated Wi-Fi delta backup completed: 18 new items transferred, 3 duplicates skipped',
      itemsProcessed: 18,
      bytesTransferred: 84200000,
      durationMs: 4200,
    },
    {
      id: 'log-2',
      timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      deviceId: 'iphone-2',
      deviceName: 'Family iPhone 14',
      level: 'success',
      trigger: 'scheduled',
      message: 'Wi-Fi connection trigger: 9 new photos transferred to SSD',
      itemsProcessed: 9,
      bytesTransferred: 36500000,
      durationMs: 2800,
    },
    {
      id: 'log-3',
      timestamp: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      deviceId: 'iphone-1',
      deviceName: "Ranjeet's iPhone 15 Pro",
      level: 'info',
      trigger: 'manual',
      message: 'Storage volume health check passed. Deduplication hash index updated.',
      itemsProcessed: 0,
      bytesTransferred: 0,
    },
  ],
  stats: {
    totalCapacityBytes: 2000398934016, // 2 TB SSD
    freeSpaceBytes: 1342177280000,     // ~1.34 TB free
    usedSpaceBytes: 658221654016,
    localVaultBytes: 7970000000,       // ~7.97 GB used by LocalVault
    totalPhotos: 2180,
    totalVideos: 126,
    totalDuplicatesSavedBytes: 1420000000, // 1.42 GB saved via deduplication
    totalDuplicatesSkipped: 312,
  },
};

// Load or initialize DB
let db: LocalVaultDb = initialDb;
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    db = { ...initialDb, ...parsed };
  } catch (err) {
    console.error('Failed to parse db.json, using default state', err);
  }
} else {
  // Seed sample demonstration photos to show how the SSD hierarchy looks
  seedSamplePhotos();
  saveDb();
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save db.json', err);
  }
}

// Seed realistic photo records and mock image files on disk so the gallery and SSD viewer are rich
function seedSamplePhotos() {
  const sampleMeta = [
    {
      device: db.devices[0],
      filename: 'IMG_4821.HEIC',
      type: 'photo' as const,
      size: 3420100,
      date: '2026-09-24T08:15:30Z',
      camera: 'iPhone 15 Pro',
      lens: '24mm f/1.78 Main Camera',
      iso: 64,
      aperture: 'f/1.8',
      shutter: '1/240s',
      city: 'Home Studio & Garden',
      w: 4032,
      h: 3024,
    },
    {
      device: db.devices[0],
      filename: 'IMG_4822.MOV',
      type: 'video' as const,
      size: 42100000,
      date: '2026-09-24T08:16:00Z',
      camera: 'iPhone 15 Pro',
      lens: '4K 60fps ProRes',
      city: 'Morning Sunlight Patio',
      w: 3840,
      h: 2160,
    },
    {
      device: db.devices[0],
      filename: 'IMG_4819.HEIC',
      type: 'live_photo' as const,
      size: 3820400,
      date: '2026-09-23T19:42:10Z',
      camera: 'iPhone 15 Pro',
      lens: '120mm f/2.8 5x Telephoto',
      iso: 125,
      aperture: 'f/2.8',
      shutter: '1/120s',
      city: 'Golden Hour Sunset',
      w: 4032,
      h: 3024,
    },
    {
      device: db.devices[1],
      filename: 'IMG_1092.HEIC',
      type: 'photo' as const,
      size: 2980000,
      date: '2026-09-23T15:20:10Z',
      camera: 'iPhone 14 Plus',
      lens: '26mm f/1.5',
      iso: 80,
      aperture: 'f/1.5',
      shutter: '1/500s',
      city: 'Family Gathering & Lunch',
      w: 4032,
      h: 3024,
    },
    {
      device: db.devices[1],
      filename: 'IMG_1090.PNG',
      type: 'screenshot' as const,
      size: 1450000,
      date: '2026-09-22T11:10:44Z',
      camera: 'iPhone 14 Plus',
      city: 'Receipt & Ticket Confirmation',
      w: 1284,
      h: 2778,
    },
    {
      device: db.devices[1],
      filename: 'IMG_1088.HEIC',
      type: 'photo' as const,
      size: 3200000,
      date: '2026-09-21T18:05:00Z',
      camera: 'iPhone 14 Plus',
      lens: '13mm f/2.4 Ultra Wide',
      iso: 200,
      aperture: 'f/2.4',
      shutter: '1/60s',
      city: 'Weekend Park Walk',
      w: 4032,
      h: 3024,
    },
  ];

  db.photos = sampleMeta.map((item, idx) => {
    const d = new Date(item.date);
    const year = d.getFullYear().toString();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const folder = `${item.device.name.replace(/[^a-zA-Z0-9_-]/g, '_')}/${year}/${month}`;
    const relPath = `${folder}/${item.filename}`;
    const absPath = path.join(DEFAULT_SSD_PATH, relPath);

    // Ensure dummy file exists for realistic demo
    const targetDir = path.dirname(absPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    if (!fs.existsSync(absPath)) {
      fs.writeFileSync(absPath, `LocalVault SSD Backup Demo File - ${item.filename}`);
    }

    const hash = crypto.createHash('sha256').update(item.filename + item.date).digest('hex');

    return {
      id: `photo-${idx + 1}`,
      deviceId: item.device.id,
      deviceName: item.device.name,
      filename: item.filename,
      originalFilename: item.filename,
      fileSize: item.size,
      mimeType: item.type === 'video' ? 'video/mp4' : item.type === 'screenshot' ? 'image/png' : 'image/heic',
      fileHash: hash,
      takenAt: item.date,
      syncedAt: new Date().toISOString(),
      mediaType: item.type,
      relativeSsdPath: relPath,
      absoluteSsdPath: absPath,
      exif: {
        cameraModel: item.camera,
        lens: item.lens,
        iso: item.iso,
        aperture: item.aperture,
        shutterSpeed: item.shutter,
        dimensions: { width: item.w, height: item.h },
        location: { latitude: 37.7749, longitude: -122.4194, city: item.city },
      },
    };
  });
}

// Setup Multer for handling uploads to SSD
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const deviceId = (req.body.deviceId as string) || 'unknown_iphone';
    const takenDateStr = (req.body.takenAt as string) || new Date().toISOString();
    const d = new Date(takenDateStr);
    const year = isNaN(d.getTime()) ? '2026' : d.getFullYear().toString();
    const month = isNaN(d.getTime()) ? '09' : String(d.getMonth() + 1).padStart(2, '0');

    const device = db.devices.find((dev) => dev.id === deviceId);
    const deviceFolderName = device ? device.name.replace(/[^a-zA-Z0-9_-]/g, '_') : deviceId;

    const targetSubdir = path.join(db.config.ssdMountPath || DEFAULT_SSD_PATH, deviceFolderName, year, month);
    fs.mkdirSync(targetSubdir, { recursive: true });
    cb(null, targetSubdir);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${timestamp}_${sanitizedOriginal}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB per item limit (supports 4K video)
});

// SSE Subscribers for live sync notifications
type SseClient = { id: string; res: express.Response };
const sseClients: SseClient[] = [];

function broadcastSse(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      // ignore
    }
  }
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// SSE stream for real-time sync telemetry
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = crypto.randomUUID();
  sseClients.push({ id: clientId, res });

  // Initial greeting ping
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    const index = sseClients.findIndex((c) => c.id === clientId);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
  });
});

// System Network & Wi-Fi status
app.get('/api/system/network', (req, res) => {
  const interfaces = os.networkInterfaces();
  const lanAddresses: { name: string; address: string; family: string }[] = [];

  for (const name of Object.keys(interfaces)) {
    const netFace = interfaces[name];
    if (netFace) {
      for (const info of netFace) {
        if (info.family === 'IPv4' && !info.internal) {
          lanAddresses.push({ name, address: info.address, family: info.family });
        }
      }
    }
  }

  const primaryIp = lanAddresses[0]?.address || db.config.pcLocalIp || '192.168.1.105';

  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    primaryIp,
    port: PORT,
    fullUrl: `http://${primaryIp}:${PORT}`,
    allInterfaces: lanAddresses,
    wifiSsid: db.config.homeWifiSsid,
  });
});

// Get configuration
app.get('/api/config', (req, res) => {
  res.json({
    config: db.config,
    stats: db.stats,
  });
});

// Update configuration
app.post('/api/config', (req, res) => {
  const updates = req.body;
  db.config = { ...db.config, ...updates };

  // If path changed, make sure it exists
  if (db.config.ssdMountPath && !fs.existsSync(db.config.ssdMountPath)) {
    try {
      fs.mkdirSync(db.config.ssdMountPath, { recursive: true });
    } catch {
      // might be a Windows letter like D:\ that isn't mounted in this container; keep path as configured
    }
  }

  saveDb();
  broadcastSse('config_updated', db.config);
  res.json({ success: true, config: db.config });
});

// Devices list
app.get('/api/devices', (req, res) => {
  res.json({ devices: db.devices });
});

// Update or create device
app.post('/api/devices', (req, res) => {
  const deviceData = req.body as Partial<Device>;
  if (!deviceData.id) {
    deviceData.id = 'iphone-' + crypto.randomBytes(3).toString('hex');
    deviceData.token = 'tok_' + crypto.randomBytes(8).toString('hex');
    deviceData.totalPhotosSynced = 0;
    deviceData.totalVideosSynced = 0;
    deviceData.totalBytesSynced = 0;
    deviceData.lastSyncAt = null;
    deviceData.status = 'idle';
  }

  const existingIdx = db.devices.findIndex((d) => d.id === deviceData.id);
  if (existingIdx >= 0) {
    db.devices[existingIdx] = { ...db.devices[existingIdx], ...deviceData } as Device;
  } else {
    db.devices.push(deviceData as Device);
  }

  saveDb();
  broadcastSse('devices_updated', db.devices);
  res.json({ success: true, device: db.devices.find((d) => d.id === deviceData.id) });
});

// Check photo hashes for deduplication before upload
app.post('/api/backup/check', (req, res) => {
  const { hashes = [] } = req.body as { hashes: string[] };
  const existingHashes = new Set(db.photos.map((p) => p.fileHash));

  const neededHashes: string[] = [];
  const duplicateHashes: string[] = [];

  for (const h of hashes) {
    if (existingHashes.has(h)) {
      duplicateHashes.push(h);
    } else {
      neededHashes.push(h);
    }
  }

  res.json({
    neededHashes,
    duplicateHashes,
    totalChecked: hashes.length,
    skippedDuplicatesCount: duplicateHashes.length,
  });
});

// Upload endpoint for photo/video backup
app.post('/api/backup/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file received' });
  }

  const {
    deviceId = 'iphone-1',
    token = '',
    takenAt = new Date().toISOString(),
    mediaType = 'photo',
    originalFilename = file.originalname,
    exifData = '{}',
  } = req.body;

  const device = db.devices.find((d) => d.id === deviceId);
  const deviceName = device ? device.name : 'iPhone Device';

  // Calculate file SHA-256 for strict deduplication
  let fileHash = '';
  try {
    const fileBuffer = fs.readFileSync(file.path);
    fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch {
    fileHash = crypto.createHash('sha256').update(file.originalname + file.size).digest('hex');
  }

  // Deduplication check
  if (db.config.deduplicationEnabled) {
    const existing = db.photos.find((p) => p.fileHash === fileHash);
    if (existing) {
      // Remove uploaded duplicate file to save SSD space
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }

      db.stats.totalDuplicatesSkipped += 1;
      db.stats.totalDuplicatesSavedBytes += file.size;
      saveDb();

      return res.json({
        status: 'duplicate_skipped',
        message: 'File already safely backed up on SSD',
        existingPhotoId: existing.id,
      });
    }
  }

  let parsedExif: any = {};
  try {
    parsedExif = JSON.parse(exifData);
  } catch {
    parsedExif = {};
  }

  const photoRecord: PhotoRecord = {
    id: 'photo-' + crypto.randomUUID(),
    deviceId,
    deviceName,
    filename: file.filename,
    originalFilename,
    fileSize: file.size,
    mimeType: file.mimetype || 'image/jpeg',
    fileHash,
    takenAt,
    syncedAt: new Date().toISOString(),
    mediaType: mediaType as any,
    relativeSsdPath: path.relative(db.config.ssdMountPath || DEFAULT_SSD_PATH, file.path),
    absoluteSsdPath: file.path,
    exif: {
      cameraModel: parsedExif.cameraModel || device?.model || 'Apple iPhone',
      lens: parsedExif.lens || 'Main Camera',
      iso: parsedExif.iso || 50,
      aperture: parsedExif.aperture || 'f/1.8',
      shutterSpeed: parsedExif.shutterSpeed || '1/120s',
      dimensions: parsedExif.dimensions || { width: 4032, height: 3024 },
      location: parsedExif.location,
    },
  };

  db.photos.unshift(photoRecord);

  // Update device stats
  if (device) {
    device.lastSyncAt = new Date().toISOString();
    device.status = 'idle';
    if (mediaType === 'video') {
      device.totalVideosSynced += 1;
    } else {
      device.totalPhotosSynced += 1;
    }
    device.totalBytesSynced += file.size;
  }

  // Update storage stats
  if (mediaType === 'video') {
    db.stats.totalVideos += 1;
  } else {
    db.stats.totalPhotos += 1;
  }
  db.stats.localVaultBytes += file.size;
  db.stats.freeSpaceBytes = Math.max(0, db.stats.freeSpaceBytes - file.size);
  db.stats.usedSpaceBytes += file.size;

  // Log sync event
  const logEvent: SyncLogEvent = {
    id: 'log-' + crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    deviceId,
    deviceName,
    level: 'success',
    trigger: 'shortcut',
    message: `Backed up ${originalFilename} (${(file.size / (1024 * 1024)).toFixed(2)} MB) to SSD`,
    itemsProcessed: 1,
    bytesTransferred: file.size,
    durationMs: 340,
  };
  db.logs.unshift(logEvent);
  if (db.logs.length > 100) db.logs.pop();

  saveDb();

  broadcastSse('photo_synced', { photo: photoRecord, log: logEvent });
  broadcastSse('stats_updated', db.stats);

  res.json({
    status: 'synced',
    photo: photoRecord,
    ssdPath: photoRecord.relativeSsdPath,
  });
});

// Photos catalog
app.get('/api/photos', (req, res) => {
  const { deviceId, mediaType, search, limit = 100 } = req.query;

  let filtered = [...db.photos];

  if (deviceId && deviceId !== 'all') {
    filtered = filtered.filter((p) => p.deviceId === deviceId);
  }

  if (mediaType && mediaType !== 'all') {
    filtered = filtered.filter((p) => p.mediaType === mediaType);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.originalFilename.toLowerCase().includes(q) ||
        p.deviceName.toLowerCase().includes(q) ||
        p.exif?.location?.city?.toLowerCase().includes(q) ||
        p.takenAt.includes(q),
    );
  }

  res.json({
    photos: filtered.slice(0, Number(limit)),
    total: filtered.length,
  });
});

// Serve real photo/video binary file or SVG placeholder
app.get('/api/photos/:id/file', (req, res) => {
  const photo = db.photos.find((p) => p.id === req.params.id);
  if (!photo) {
    return res.status(404).send('Photo not found');
  }

  if (fs.existsSync(photo.absoluteSsdPath)) {
    // If it's a real image/video binary, stream it directly
    const stat = fs.statSync(photo.absoluteSsdPath);
    if (stat.size > 200) {
      return res.sendFile(photo.absoluteSsdPath);
    }
  }

  // Render a high-fidelity SVG preview for demo seed files
  const dateStr = new Date(photo.takenAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const color = photo.deviceId === 'iphone-1' ? '#0284c7' : '#8b5cf6';
  const iconText = photo.mediaType === 'video' ? '▶ VIDEO' : photo.mediaType === 'screenshot' ? '📱 SCREENSHOT' : '📷 PHOTO';

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="50%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
      <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color}" />
        <stop offset="100%" stop-color="#3b82f6" />
      </linearGradient>
    </defs>
    <rect width="800" height="600" fill="url(#bgGrad)" />
    
    <!-- Camera viewfinder grid lines -->
    <line x1="266" y1="40" x2="266" y2="560" stroke="#334155" stroke-width="1" stroke-dasharray="4 4" opacity="0.4" />
    <line x1="533" y1="40" x2="533" y2="560" stroke="#334155" stroke-width="1" stroke-dasharray="4 4" opacity="0.4" />
    <line x1="40" y1="200" x2="760" y2="200" stroke="#334155" stroke-width="1" stroke-dasharray="4 4" opacity="0.4" />
    <line x1="40" y1="400" x2="760" y2="400" stroke="#334155" stroke-width="1" stroke-dasharray="4 4" opacity="0.4" />
    
    <!-- Central graphic -->
    <circle cx="400" cy="270" r="110" fill="#1e293b" stroke="#334155" stroke-width="2" />
    <circle cx="400" cy="270" r="75" fill="none" stroke="url(#accentGrad)" stroke-width="6" opacity="0.8" />
    <circle cx="400" cy="270" r="35" fill="${color}" opacity="0.3" />
    
    <!-- Filename & Details -->
    <text x="400" y="420" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="600" text-anchor="middle">${photo.originalFilename}</text>
    <text x="400" y="450" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="14" text-anchor="middle">${photo.deviceName} · ${dateStr} · ${(photo.fileSize / (1024 * 1024)).toFixed(1)} MB</text>
    <text x="400" y="475" fill="#64748b" font-family="monospace" font-size="12" text-anchor="middle">SSD: ${photo.relativeSsdPath}</text>
    
    <!-- Top badge -->
    <rect x="330" y="70" width="140" height="28" rx="6" fill="#1e293b" stroke="#334155" />
    <text x="400" y="89" fill="${color}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="12" font-weight="700" text-anchor="middle">${iconText}</text>
  </svg>
  `;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});

// Delete photo
app.delete('/api/photos/:id', (req, res) => {
  const index = db.photos.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Photo not found' });
  }

  const photo = db.photos[index];
  try {
    if (fs.existsSync(photo.absoluteSsdPath)) {
      fs.unlinkSync(photo.absoluteSsdPath);
    }
  } catch (err) {
    console.warn('Could not delete physical file', err);
  }

  db.photos.splice(index, 1);
  saveDb();
  broadcastSse('photo_deleted', { id: photo.id });
  res.json({ success: true });
});

// Logs
app.get('/api/logs', (req, res) => {
  res.json({ logs: db.logs });
});

// Simulate an automated Wi-Fi backup trigger (useful for testing on PC and previewing schedule)
app.post('/api/test/simulate-sync', (req, res) => {
  const { deviceId = 'iphone-1', count = 5 } = req.body;
  const device = db.devices.find((d) => d.id === deviceId) || db.devices[0];

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const folder = `${device.name.replace(/[^a-zA-Z0-9_-]/g, '_')}/${year}/${month}`;
  const targetDir = path.join(db.config.ssdMountPath || DEFAULT_SSD_PATH, folder);
  fs.mkdirSync(targetDir, { recursive: true });

  const addedPhotos: PhotoRecord[] = [];
  let totalBytes = 0;

  for (let i = 0; i < count; i++) {
    const photoNum = 5000 + Math.floor(Math.random() * 4000);
    const filename = `IMG_${photoNum}.HEIC`;
    const fileSize = Math.floor(2500000 + Math.random() * 3000000); // 2.5MB - 5.5MB
    totalBytes += fileSize;

    const absPath = path.join(targetDir, filename);
    fs.writeFileSync(absPath, `LocalVault SSD Backup Simulated Photo - ${filename}`);

    const hash = crypto.createHash('sha256').update(filename + Date.now() + i).digest('hex');

    const photoRecord: PhotoRecord = {
      id: 'photo-' + crypto.randomUUID(),
      deviceId: device.id,
      deviceName: device.name,
      filename,
      originalFilename: filename,
      fileSize,
      mimeType: 'image/heic',
      fileHash: hash,
      takenAt: new Date(Date.now() - Math.floor(Math.random() * 48 * 3600 * 1000)).toISOString(),
      syncedAt: new Date().toISOString(),
      mediaType: 'photo',
      relativeSsdPath: `${folder}/${filename}`,
      absoluteSsdPath: absPath,
      exif: {
        cameraModel: device.model,
        lens: '24mm f/1.78 Main Camera',
        iso: 100,
        aperture: 'f/1.8',
        shutterSpeed: '1/250s',
        dimensions: { width: 4032, height: 3024 },
        location: { latitude: 37.7749, longitude: -122.4194, city: 'Home Wi-Fi AutoSync' },
      },
    };

    db.photos.unshift(photoRecord);
    addedPhotos.push(photoRecord);
  }

  device.totalPhotosSynced += count;
  device.totalBytesSynced += totalBytes;
  device.lastSyncAt = new Date().toISOString();
  device.status = 'idle';

  db.stats.totalPhotos += count;
  db.stats.localVaultBytes += totalBytes;
  db.stats.freeSpaceBytes = Math.max(0, db.stats.freeSpaceBytes - totalBytes);
  db.stats.usedSpaceBytes += totalBytes;

  const logEvent: SyncLogEvent = {
    id: 'log-' + crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    deviceId: device.id,
    deviceName: device.name,
    level: 'success',
    trigger: 'scheduled',
    message: `Auto Wi-Fi backup routine triggered for ${device.name}: ${count} new photos saved to SSD`,
    itemsProcessed: count,
    bytesTransferred: totalBytes,
    durationMs: 1200 + count * 200,
  };
  db.logs.unshift(logEvent);

  saveDb();

  broadcastSse('sync_batch_completed', {
    deviceId: device.id,
    count,
    photos: addedPhotos,
    log: logEvent,
  });

  res.json({
    success: true,
    addedCount: count,
    totalBytesTransferred: totalBytes,
    targetSsdFolder: folder,
    device,
  });
});

// iOS Shortcut Setup & Generator endpoint
app.get('/api/shortcuts/recipe/:deviceId', (req, res) => {
  const deviceId = req.params.deviceId;
  const device = db.devices.find((d) => d.id === deviceId) || db.devices[0];
  const lanIp = db.config.pcLocalIp || getLocalIp();
  const endpointUrl = `http://${lanIp}:${PORT}/api/backup/upload`;

  const shortcutRecipe = {
    title: `LocalVault Auto Backup - ${device.name}`,
    description: 'Automatically backs up recent iPhone photos and videos to your PC SSD when connected to home Wi-Fi.',
    deviceId: device.id,
    token: device.token,
    endpointUrl,
    wifiSsid: device.syncSchedule.wifiSsid || db.config.homeWifiSsid,
    schedule: device.syncSchedule,
    steps: [
      {
        step: 1,
        name: 'Check Wi-Fi Network',
        action: 'Get Network Details (Wi-Fi Network Name)',
        condition: `If Wi-Fi Network Name equals "${device.syncSchedule.wifiSsid || 'Home_WiFi'}"`,
      },
      {
        step: 2,
        name: 'Find New Photos',
        action: 'Find Photos where "Date Taken" is in the last 24 hours (or since last sync date)',
      },
      {
        step: 3,
        name: 'Upload to PC SSD',
        action: 'Repeat with each photo item: Get Contents of URL',
        url: endpointUrl,
        method: 'POST',
        headers: {
          'X-Device-Id': device.id,
          'X-Device-Token': device.token,
        },
        bodyType: 'Form',
        fields: {
          file: '[Current Photo Item]',
          deviceId: device.id,
          takenAt: '[Photo Date Taken]',
          originalFilename: '[Photo Name]',
        },
      },
      {
        step: 4,
        name: 'Show Notification',
        action: 'Show notification: "LocalVault: Photos backed up to PC SSD"',
      },
    ],
  };

  res.json(shortcutRecipe);
});

// Setup Vite or static serving
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LocalVault SSD Backup Server running at: http://localhost:${PORT}`);
    console.log(`Local LAN endpoint for iPhones: http://${defaultIp}:${PORT}`);
  });
}

startServer();
