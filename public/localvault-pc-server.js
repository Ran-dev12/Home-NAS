const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/**
 * LocalVault - PC External SSD Photo Backup Server
 * 
 * Works out-of-the-box on Windows, Mac, or Linux.
 * Zero setup, CommonJS compatible (no package.json config required).
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Default to the drive the script is placed on, or E:\iPhone_Photos_SSD
let defaultSsdPath = 'E:\\iPhone_Photos_SSD';
if (process.platform !== 'win32') {
  defaultSsdPath = path.join(os.homedir(), 'iPhone_Photos_SSD');
} else {
  // If running on drive E:\ or D:\, keep it in the current drive
  const currentDrive = path.parse(process.cwd()).root;
  defaultSsdPath = path.join(currentDrive, 'iPhone_Photos_SSD');
}

const SSD_MOUNT_PATH = process.env.SSD_PATH || defaultSsdPath;

console.log('====================================================');
console.log('   LocalVault - Dual iPhone Auto Wi-Fi SSD Server   ');
console.log('====================================================');
console.log(`[Target SSD Folder] ${SSD_MOUNT_PATH}`);

// Ensure SSD folder exists
try {
  fs.mkdirSync(SSD_MOUNT_PATH, { recursive: true });
  console.log(`[Storage] Target folder ready.`);
} catch (err) {
  console.warn(`[Storage Warning] Could not create folder at ${SSD_MOUNT_PATH}:`, err.message);
}

// Deduplication index
const MANIFEST_FILE = path.join(SSD_MOUNT_PATH, '.localvault_manifest.json');
let knownHashes = new Set();

try {
  if (fs.existsSync(MANIFEST_FILE)) {
    const raw = fs.readFileSync(MANIFEST_FILE, 'utf-8');
    const list = JSON.parse(raw);
    knownHashes = new Set(list);
    console.log(`[Deduplication] Loaded ${knownHashes.size} existing photo hashes.`);
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

// Get PC LAN IP
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

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Multer storage: organizes directly on external SSD: [SSD] / [Device] / [YYYY] / [MM] / [file]
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

// Health check
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

// Upload endpoint for photos and videos from iPhones
app.post('/api/backup/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file received' });
  }

  // Calculate SHA-256 for deduplication
  let fileHash = '';
  try {
    const buf = fs.readFileSync(file.path);
    fileHash = crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    fileHash = crypto.createHash('sha256').update(file.originalname + file.size).digest('hex');
  }

  // Skip duplicate
  if (knownHashes.has(fileHash)) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    console.log(`[Duplicate Skipped] ${file.originalname} (Already on SSD)`);
    return res.json({
      status: 'duplicate_skipped',
      message: 'Photo already exists on SSD'
    });
  }

  knownHashes.add(fileHash);
  saveManifest();

  console.log(`[Backed up to SSD] ${file.originalname} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`  -> Saved at: ${file.path}`);

  res.json({
    status: 'synced',
    filename: file.filename,
    path: file.path,
    size: file.size
  });
});

// Built-in Mobile Web Upload Companion UI so iPhones can test immediately via Safari
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LocalVault - PC External SSD Backup</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; margin: 0; }
      .card { background: #1e293b; border-radius: 16px; padding: 24px; max-width: 480px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
      h1 { font-size: 20px; margin-top: 0; color: #38bdf8; }
      .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 10px; border-radius: 999px; font-size: 12px; margin-bottom: 12px; }
      .path { font-family: monospace; background: #090d16; padding: 8px 12px; border-radius: 8px; font-size: 11px; word-break: break-all; color: #94a3b8; }
      .btn { display: block; width: 100%; box-sizing: border-box; background: #0284c7; color: white; padding: 14px; border: none; border-radius: 12px; font-size: 15px; font-weight: bold; margin-top: 16px; cursor: pointer; text-align: center; }
      .device-select { width: 100%; padding: 10px; border-radius: 8px; background: #090d16; color: white; border: 1px solid #334155; margin-top: 8px; }
      #status { margin-top: 16px; font-size: 13px; line-height: 1.5; color: #34d399; }
      .progress { width: 100%; height: 8px; background: #334155; border-radius: 4px; overflow: hidden; margin-top: 10px; display: none; }
      .progress-bar { width: 0%; height: 100%; background: #38bdf8; transition: width 0.2s; }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="badge">SSD Gateway Live</span>
      <h1>LocalVault Photo Sync</h1>
      <p style="font-size: 13px; color: #94a3b8;">Backing up directly over Wi-Fi to your PC External SSD:</p>
      <div class="path">${SSD_MOUNT_PATH}</div>

      <div style="margin-top: 16px;">
        <label style="font-size: 12px; color: #cbd5e1;">Select iPhone:</label>
        <select id="deviceSelect" class="device-select">
          <option value="iPhone_1_Ranjeet">iPhone 1 (Ranjeet)</option>
          <option value="iPhone_2_Family">iPhone 2 (Family)</option>
        </select>
      </div>

      <input type="file" id="filePicker" multiple accept="image/*,video/*,.heic,.mov,.mp4" style="display: none;" onchange="uploadFiles(this.files)">
      
      <button class="btn" onclick="document.getElementById('filePicker').click()">Select Photos / Videos to Backup</button>

      <div class="progress" id="progressWrap">
        <div class="progress-bar" id="progressBar"></div>
      </div>

      <div id="status"></div>
    </div>

    <script>
      async function uploadFiles(files) {
        if (!files || !files.length) return;
        const statusEl = document.getElementById('status');
        const progressWrap = document.getElementById('progressWrap');
        const progressBar = document.getElementById('progressBar');
        const deviceName = document.getElementById('deviceSelect').value;

        progressWrap.style.display = 'block';
        statusEl.innerHTML = 'Starting transfer of ' + files.length + ' item(s)...';

        let count = 0;
        let skipped = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const pct = Math.round(((i + 1) / files.length) * 100);
          progressBar.style.width = pct + '%';
          statusEl.innerHTML = 'Uploading (' + (i + 1) + '/' + files.length + '): ' + file.name;

          const fd = new FormData();
          fd.append('file', file);
          fd.append('deviceName', deviceName);
          fd.append('takenAt', new Date(file.lastModified).toISOString());

          try {
            const res = await fetch('/api/backup/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.status === 'duplicate_skipped') skipped++;
            else count++;
          } catch (e) {
            console.error(e);
          }
        }

        statusEl.innerHTML = '<b>Done!</b> ' + count + ' items saved to SSD.<br>' + (skipped ? skipped + ' duplicates skipped automatically.' : '');
      }
    </script>
  </body>
  </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('----------------------------------------------------');
  console.log(`[SUCCESS] LocalVault PC Server is LIVE!`);
  console.log(`  Access from iPhone Browser: http://${LAN_IP}:${PORT}`);
  console.log(`  Shortcuts Upload Endpoint:  http://${LAN_IP}:${PORT}/api/backup/upload`);
  console.log(`  Target SSD Folder:          ${SSD_MOUNT_PATH}`);
  console.log('----------------------------------------------------');
});
