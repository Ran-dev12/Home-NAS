#!/usr/bin/env bash
# HomeNAS installer for a Raspberry Pi 4/5 running Raspberry Pi OS (64-bit), or any Debian/Ubuntu machine.
#
#   cd ~/HomeNAS
#   bash scripts/install-pi.sh
#
# Safe to run again: it updates what is there and skips what is done.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
PORT=4300

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m%s\n' "$*"; }
ask()  { local reply; read -r -p "$1 [y/N] " reply; [[ "$reply" =~ ^[Yy] ]]; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not with sudo. It asks for your password when it needs it."
  exit 1
fi
case "$(uname -m)" in
  aarch64|x86_64) ;;
  *) echo "This is a $(uname -m) system. HomeNAS needs 64-bit Linux (Raspberry Pi OS 64-bit on a Pi 4 or Pi 5)."; exit 1 ;;
esac

# ---- 1. System packages -----------------------------------------------------------------------------
say "Installing system packages: ffmpeg (video thumbnails), libheif (iPhone photos), disk tools"
sudo apt-get update
sudo apt-get install -y curl ca-certificates ffmpeg libheif-examples exfatprogs ntfs-3g
# On newer releases the HEVC decoder libheif needs for iPhone photos is a separate plugin.
sudo apt-get install -y libheif-plugin-libde265 2>/dev/null || true
if command -v heif-dec >/dev/null || command -v heif-convert >/dev/null; then
  echo "Native iPhone photo (HEIC) decoder: found"
else
  warn "libheif's decoder was not found. iPhone photos still work, but thumbnails are made more slowly."
fi

# ---- 2. Node.js 24 or newer ---------------------------------------------------------------------------
node_major=0
if command -v node >/dev/null; then node_major="$(node -p 'process.versions.node.split(".")[0]')"; fi
if (( node_major < 24 )); then
  say "Installing Node.js 24 (from NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node.js $(node --version)"

# ---- 3. HomeNAS itself ------------------------------------------------------------------------------------
say "Installing HomeNAS components for this computer"
cd "$APP_DIR"
# A copy made on Windows carries Windows-only parts (image library, build tools). Always start clean.
rm -rf node_modules
npm ci --no-audit --no-fund || npm install --no-audit --no-fund
if ! npm run build; then
  if [[ -f dist/index.html ]]; then warn "Rebuilding the web interface failed; using the copy that came with the files."
  else echo "Building the web interface failed. Scroll up for the error."; exit 1; fi
fi
mkdir -p data

# ---- 4. The SSD ----------------------------------------------------------------------------------------
say "The SSD"
echo "HomeNAS keeps everything on the SSD, so the SSD must be mounted at the same place on every boot."
echo
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT -e 7
echo
if ask "Set the SSD to mount automatically now? (skip if you have already done this)"; then
  read -r -p "Partition from the NAME column above, for example sda1: " part
  dev="/dev/${part#/dev/}"
  if [[ ! -b "$dev" ]]; then warn "$dev is not a disk partition. Nothing was changed."; exit 1; fi
  uuid="$(sudo blkid -s UUID -o value "$dev")"
  fstype="$(sudo blkid -s TYPE -o value "$dev")"
  if [[ -z "$uuid" || -z "$fstype" ]]; then warn "Could not read that partition. Nothing was changed."; exit 1; fi
  read -r -p "Mount it at [/mnt/ssd]: " mnt
  mnt="${mnt:-/mnt/ssd}"
  uid="$(id -u)"; gid="$(id -g)"
  # nofail: the Pi still boots without the SSD (HomeNAS then waits for it instead of writing to the SD card).
  common="nofail,noatime,x-systemd.device-timeout=15s"
  case "$fstype" in
    ext4|ext3|xfs|btrfs|f2fs) line="UUID=$uuid  $mnt  $fstype  defaults,$common  0  2"; owned_by_mount=0 ;;
    exfat)                    line="UUID=$uuid  $mnt  exfat  defaults,$common,uid=$uid,gid=$gid,umask=022  0  0"; owned_by_mount=1 ;;
    ntfs)                     line="UUID=$uuid  $mnt  ntfs-3g  defaults,$common,uid=$uid,gid=$gid,umask=022  0  0"; owned_by_mount=1 ;;
    vfat) warn "This partition is FAT32, which cannot hold files over 4 GB (long videos). Reformat it as ext4 or exFAT first."; exit 1 ;;
    *)    warn "Filesystem '$fstype' is not supported here. Use ext4 (Pi only), exFAT or NTFS."; exit 1 ;;
  esac
  echo
  echo "This line will be added to /etc/fstab:"
  echo "  $line"
  if grep -q "UUID=$uuid" /etc/fstab; then
    warn "That disk is already in /etc/fstab. Leaving it unchanged."
  elif ask "Add it?"; then
    sudo cp /etc/fstab "/etc/fstab.before-homenas.$(date +%Y%m%d%H%M%S)"
    sudo mkdir -p "$mnt"
    echo "$line" | sudo tee -a /etc/fstab >/dev/null
    sudo systemctl daemon-reload
    if ! sudo findmnt --verify --tab-file /etc/fstab >/dev/null 2>&1; then
      warn "findmnt reports a problem in /etc/fstab. A backup was saved next to it (fstab.before-homenas.*)."
    fi
    sudo mount "$mnt"
    if (( owned_by_mount == 0 )); then sudo chown "$RUN_USER:$RUN_GROUP" "$mnt"; fi
    df -h "$mnt"
    echo "In the setup wizard, choose a folder on it, for example $mnt/HomeNAS"
  fi
fi

# ---- 5. Start on boot --------------------------------------------------------------------------------
say "Setting HomeNAS to start on boot"
node_bin="$(command -v node)"
sudo tee /etc/systemd/system/homenas.service >/dev/null <<EOF
[Unit]
Description=HomeNAS home storage server
Wants=network-online.target
After=network-online.target local-fs.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$APP_DIR
ExecStart=$node_bin server/index.ts --prod
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable homenas >/dev/null
sudo systemctl restart homenas
sleep 4

host="$(hostname).local"
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Done. HomeNAS is running."
echo "On a laptop or phone on the same network, open one of:"
echo "  http://$host:$PORT"
[[ -n "$ip" ]] && echo "  http://$ip:$PORT"
code="$(sudo journalctl -u homenas -n 60 --no-pager 2>/dev/null | grep -o 'Setup code: *[0-9]*' | tail -1 | grep -o '[0-9]*$' || true)"
if [[ -n "$code" ]]; then
  echo
  echo "First-time setup code: $code"
fi
echo
echo "Useful commands:"
echo "  sudo systemctl status homenas        is it running?"
echo "  sudo journalctl -u homenas -f        live log (the setup code is shown here too)"
echo "  sudo systemctl restart homenas       restart after copying in a new version"
echo "  sudo mount -a                        after plugging the SSD back in"
