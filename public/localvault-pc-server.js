import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

/**
 * LocalVault - PC-Side External SSD Photo Backup Server
 * 
 * Run on your Windows PC (or Mac/Linux) where your external SSD is connected.
 * 
 * Prerequisites:
 *   1. Node.js installed (https://nodejs.org)
 *   2. Run: npm install express multer
 *   3. Connect your External SSD (e.g. D:\ or E:\ on Windows)
 *   4. Run: node localvault-pc-server.js
 */

const PORT = 3000;

// Set your External SSD folder path below:
// Windows example: 'D:\\iPhone_Photos_SSD' or 'E:\\Photos_Vault'
// Mac example: '/Volumes/Samsung_T7/Photos_Vault'
// Linux example: '/media/user/SSD/Photos_Vault'
const SSD_MOUNT_PATH = process.env.SSD_PATH || (process.platform === 'win32' ? 'D:\\iPhone_Photos_SSD' : path.join(os.homedir(), 'iPhone_Photos_SSD'));

console.log('====================================================');
console.log('  LocalVault - Dual iPhone Auto Wi-Fi SSD Server');
console.log('====================================================');
console.log(`Target SSD Folder: ${SSD_MOUNT_PATH}`);

// Ensure SSD folder exists
try {
  fs.mkdirSync(SSD_MOUNT_PATH, { recursive: true });
  console.log(`[OK] SSD target directory confirmed.`);
} catch (err) {
  console.warn(`[WARN] Could not create folder at ${SSD_MOUNT_PATH}. Make sure your SSD is plugged in!`, err.message);
}

// Keep a local manifest of SHA-256 hashes to prevent duplicate uploads
const MANIFEST_FILE = path.join(SSD_MOUNT_PATH, '.localvault_manifest.json');
let knownHashes = new Set();

try {
  if (fs.existsSync(MANIFEST_FILE)) {
    const raw = fs.readFileSync(MANIFEST_FILE, 'utf-8');
    const list = JSON.parse(raw);
    knownHashes = new Set(list);
    console.log(`[Index] Loaded ${knownHashes.size} known photo hashes for deduplication.`);
  }
} catch (e) {
  knownHashes = new Set();
}

function saveManifest() {
  try {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(Array.from(knownHashes), null, 2));
  } catch (err) {
    // ignore
  }
}

// Find PC Local IP on your Wi-Fi
function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLanIp();

const app = express();
app.use(express.json({ limit: '50mb' }));

// Multer storage engine - writes directly to SSD
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const deviceName = (req.body.deviceName || req.body.deviceId || 'iPhone').replace(/[^a-zA-Z0-9_-]/g, '_');
    const takenDateStr = req.body.takenAt || new Date().toISOString();
    const d = new Date(takenDateStr);
    const year = isNaN(d.getTime()) ? '2026' : d.getFullYear().toString();
    const month = isNaN(d.getTime()) ? '09' : String(d.getMonth() + 1).padStart(2, '0');

    const destDir = path.join(SSD_MOUNT_PATH, deviceName, year, month);
    fs.mkdirSync(destDir, { recursive: true });
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  }
});

const upload = multer({ storage });

// Health check endpoint for iPhone
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    server: 'LocalVault PC SSD Server',
    ssdPath: SSD_MOUNT_PATH,
    lanIp: LAN_IP,
    totalPhotosIndexed: knownHashes.size
  });
});

// Deduplication check endpoint
app.post('/api/backup/check', (req, res) => {
  const hashes = req.body.hashes || [];
  const neededHashes = [];
  const duplicateHashes = [];

  for (const h of hashes) {
    if (knownHashes.has(h)) {
      duplicateHashes.push(h);
    } else {
      neededHashes.push(h);
    }
  }

  res.json({
    neededHashes,
    duplicateHashes,
    skippedDuplicatesCount: duplicateHashes.length
  });
});

// Upload endpoint
app.post('/api/backup/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file received' });
  }

  // Calculate file hash
  let fileHash = '';
  try {
    const buf = fs.readFileSync(file.path);
    fileHash = crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    fileHash = crypto.createHash('sha256').update(file.originalname + file.size).digest('hex');
  }

  // Skip if duplicate
  if (knownHashes.has(fileHash)) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    return res.json({
      status: 'duplicate_skipped',
      message: 'Photo already exists on SSD'
    });
  }

  knownHashes.add(fileHash);
  saveManifest();

  console.log(`[Backup Saved] -> ${file.path} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);

  res.json({
    status: 'synced',
    filename: file.filename,
    path: file.path,
    size: file.size
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('----------------------------------------------------');
  console.log(`Server is LIVE on your Home Wi-Fi!`);
  console.log(`From your 2 iPhones, access: http://${LAN_IP}:${PORT}`);
  console.log(`Direct SSD upload endpoint:  http://${LAN_IP}:${PORT}/api/backup/upload`);
  console.log('----------------------------------------------------');
});
