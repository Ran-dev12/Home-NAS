import os
import sys
import hashlib
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify

# LocalVault - Python Server for PC with Connected SSD
# 
# How to run on your PC:
#   1. Install python (if not installed)
#   2. Run: pip install flask
#   3. Run: python localvault-pc-server.py
#
# No Raspberry Pi needed! Runs directly on your Windows, Mac, or Linux PC.

PORT = 3000

# Set your external SSD path here:
# Windows: r"D:\iPhone_Photos_SSD" or r"E:\iPhone_Photos_SSD"
# Mac: "/Volumes/Samsung_T7/iPhone_Photos_SSD"
SSD_PATH = Path(r"D:\iPhone_Photos_SSD") if sys.platform == "win32" else Path.home() / "iPhone_Photos_SSD"
SSD_PATH.mkdir(parents=True, exist_ok=True)

MANIFEST_FILE = SSD_PATH / ".localvault_manifest.txt"
known_hashes = set()

if MANIFEST_FILE.exists():
    with open(MANIFEST_FILE, "r") as f:
        known_hashes = set(line.strip() for line in f if line.strip())

app = Flask(__name__)

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "online",
        "ssdPath": str(SSD_PATH),
        "totalPhotos": len(known_hashes)
    })

@app.route('/api/backup/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    device_name = request.form.get('deviceName', request.form.get('deviceId', 'iPhone'))
    safe_device = "".join(c for c in device_name if c.isalnum() or c in ('_', '-'))
    
    now = datetime.now()
    year = now.strftime("%Y")
    month = now.strftime("%m")
    
    target_dir = SSD_PATH / safe_device / year / month
    target_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{timestamp}_{file.filename}"
    target_filepath = target_dir / safe_filename
    
    file.save(str(target_filepath))
    
    # Calculate SHA-256
    hasher = hashlib.sha256()
    with open(target_filepath, 'rb') as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    file_hash = hasher.hexdigest()
    
    # Check deduplication
    if file_hash in known_hashes:
        target_filepath.unlink(missing_ok=True)
        return jsonify({"status": "duplicate_skipped", "message": "Photo already on SSD"})
    
    known_hashes.add(file_hash)
    with open(MANIFEST_FILE, "a") as f:
        f.write(file_hash + "\n")
        
    print(f"Backed up to SSD: {target_filepath}")
    return jsonify({
        "status": "synced",
        "filename": safe_filename,
        "path": str(target_filepath)
    })

if __name__ == '__main__':
    print(f"LocalVault Python PC Server running! SSD Path: {SSD_PATH}")
    print(f"Port: {PORT}")
    app.run(host='0.0.0.0', port=PORT)
