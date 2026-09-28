# HomeNAS

A home NAS that runs on an ordinary Windows PC with an external SSD. The family gets:

- **Files**: a private folder for each person, plus shared folders with view-only or edit access. Upload (including whole folders) by dragging into the browser, download, zip, move, rename, search, preview.
- **Photos**: one timeline of every photo and video you can access, sorted by when it was taken, with thumbnails (including iPhone HEIC), EXIF details and location.
- **Phone backup**: iPhones back up photos, videos, screenshots and chosen Files-app folders over Wi-Fi by themselves when they charge at home (cable, MagSafe or wireless), using the built-in Shortcuts app. Nothing to install from the App Store.
- **Share links**: view or download links for people without an account, with an optional password and expiry.
- **Trash**: nothing is deleted straight away. Items stay recoverable for 30 days (configurable).

It started from the idea in [Ran-dev12/Home-NAS](https://github.com/Ran-dev12/Home-NAS) (LocalVault), rebuilt with a phone sync that works within what iOS Shortcuts can do, real accounts and permissions, and storage that stays safe when the drive is unplugged.

## Quick start

Needs **Windows 10/11**, **Node.js 24 or newer** (https://nodejs.org), and the SSD plugged in. For a small always-on box instead of a PC, see [Running on a Raspberry Pi](#running-on-a-raspberry-pi).

1. Double-click **`start-homenas.cmd`**. The first run installs components and builds the interface.
2. When Windows Firewall asks, allow access on **Private networks**. Without that, phones cannot reach the NAS.
3. On the PC, open **http://localhost:4300**. The setup wizard asks which drive to use (pick the SSD; network drives are refused) and creates your admin account.
4. On any phone or laptop on the same Wi-Fi, open the address shown in the HomeNAS window, for example `http://192.168.1.20:4300`.

Optional: install **ffmpeg** (`winget install Gyan.FFmpeg`) for video thumbnails, video dates and durations. Everything else works without it.

### Running it like an appliance

- **Start with Windows**: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1` runs HomeNAS hidden each time you sign in. Logs go to `data\homenas.log`. Add `-Remove` to undo.
- **Keep the PC awake**: Settings → System → Power → Screen and sleep → set *When plugged in, put my device to sleep* to *Never*. A sleeping PC means no backups.
- **Give the PC a fixed address**: in your router, add a DHCP reservation for this PC. The phones’ shortcuts contain its address, and if it changes they stop finding it. You can also set the address under Admin → Settings.
- **Network type must be Private**: Settings → Network & internet → your Wi-Fi/Ethernet → *Private network*. On a *Public* network, Windows blocks incoming connections.

## Phone backup (iPhone)

Phones → **Add phone** asks what this phone should back up (photos, videos, screenshots, files and folders; change it later under the phone’s menu → *What to back up…*), then gives a QR code. Scan it with the iPhone camera and the setup steps open on the phone, with copy buttons for everything. You build the shortcut once (about five minutes) and add an automation, *When charger connects → Run Immediately*. From then on it is **automatic**: every time the phone charges at home it backs up and shows “Backed up 12 new items”. An optional second automation at, say, 3:00 AM catches phones that sit on the charger all evening.

**Ready-made shortcut.** Instead of building the shortcut by hand, run `python3 scripts/make-shortcut.py --server http://<NAS address>:4300` on a Mac. It writes a signed `HomeNAS Backup.shortcut` (photos, videos and screenshots) to AirDrop to the iPhone; on import it asks for the address and the phone’s key.

**Adding more phones.** Each phone gets its own key and its own folder. The person it belongs to signs in (Admin → Users adds people) and chooses Phones → Add phone. You do not rebuild the shortcut: the NAS address and the key each live in a single Text action at the top of it, so you share the finished shortcut from the first iPhone by iCloud link (with the key temporarily replaced by a placeholder), and on the new phone paste its own key into that one line. The setup page walks through this.

Each phone’s backups land in their own tree, sorted by kind:

```
users\ranjeet\Phone Backup\
    Ranjeet's iPhone 15 Pro\
        Photos\2026\09\IMG_3001.HEIC
        Videos\2026\09\IMG_3002.MOV
        Screenshots\2026\09\IMG_3003.PNG
        Files\Documents\Taxes\receipt.pdf
    Mum's iPhone\
        Photos\2026\08\IMG_0412.HEIC
users\priya\Phone Backup\
    Priya's iPhone\...
```

The setup steps follow the phone’s choices (for example a Find Photos filter that leaves out screenshots). If the shortcut sends something that is turned off, the NAS skips it.

How the sync works, and why:

- iOS Shortcuts cannot compute file hashes, so the phone cannot ask “do you already have this?”. Instead the NAS remembers, per phone, the newest photo it has safely stored. The shortcut asks for that date, finds newer photos **oldest first**, and uploads them in batches (300 by default).
- An interrupted run (screen locked, Wi-Fi dropped) resumes where it stopped. Duplicates are detected by content hash and skipped.
- If a shortcut sends photos newest-first, the NAS refuses to move its bookmark, so nothing is ever skipped, and the Phones page tells you to fix the sort order.
- A photo with a wrong clock (dated in the future) is stored, but never moves the bookmark.
- Photos land in `My files/Phone Backup/<phone>/Photos/<year>/<month>/` (videos under `Videos`, screenshots under `Screenshots`) with the file date set to when they were taken. Screenshots are recognised by the “Screenshot” comment iOS writes into them.
- **Files and folders**: for each folder picked in the shortcut, and each file in it, the shortcut first asks the NAS whether it needs the file (by name, creation date, modification date and size). Only new or changed files are uploaded, to `Files/<folder name>/`. A changed file replaces its copy and the old version goes to the trash. Files deleted on the phone stay on the NAS. Shortcuts cannot report a file’s subfolder path, so files from subfolders of a picked folder sit together in that folder; pick subfolders separately to keep them apart.

Things Shortcuts cannot do: data inside other apps (chats, app settings, Health) is out of reach, so keep iCloud Backup on or use the Apple Devices app for full backups; the motion part of **Live Photos** is not backed up (the still is); and photos added to the phone with an *old* date (for example AirDropped) are older than the bookmark. Use the phone’s menu → *Back up again from…* to sweep a date range again; anything already on the NAS is skipped.

A large existing library catches up over several charges. For a faster first run, copy the old photos over USB into the phone’s backup folder; later syncs recognise them.

## Running on a Raspberry Pi

A PC left on all day uses roughly 50–100 W. A Raspberry Pi 5 with the SSD uses about 3–5 W, sits next to the router, and runs HomeNAS the same way. An Intel N100 mini PC (about 6–10 W) is the other good option: it runs the Windows version above unchanged.

> Pi support is built and unit-tested (drive detection, network-mount refusal, case-sensitive file names, native HEIC decoding with a safe fallback), but it has not yet been run on a real Pi. Please report anything odd.

**Hardware**
- Raspberry Pi 5 (4 GB is enough; 8 GB gives headroom) or a Pi 4.
- The **official 27 W USB-C power supply**. With a weaker one the Pi 5 limits USB power, and a USB SSD can drop out under load.
- A case with a fan or the active cooler, and a microSD card (16 GB or more) for the operating system.
- The SSD in a USB 3 enclosure, plugged into a **blue** USB 3 port. Ethernet to the router is faster and steadier than Wi-Fi.

**1. Prepare the Pi.** With Raspberry Pi Imager, write **Raspberry Pi OS Lite (64-bit)** to the card. In its settings, set the hostname to `homenas`, create your user, and turn on SSH (and Wi-Fi if you are not using a cable).

**2. The SSD’s format.**
- Moving the SSD over from the Windows PC with HomeNAS already on it? Keep it as it is (NTFS or exFAT both work), and all users, files and phone settings come along.
- Starting fresh and keeping the SSD on the Pi for good? ext4 is the most robust. Windows cannot read ext4 directly, though.
- Never FAT32: it cannot hold files over 4 GB.

**3. Copy HomeNAS to the Pi.** Copy the folder **without `node_modules`** (it holds Windows-only parts), for example with WinSCP or a USB stick, to `/home/<you>/HomeNAS`. `git clone` of the repository works too.

**4. Install.** Over SSH (`ssh <you>@homenas.local`):

```
cd ~/HomeNAS
bash scripts/install-pi.sh
```

It installs Node.js 24, ffmpeg and the native iPhone photo decoder, builds HomeNAS for the Pi, offers to mount the SSD at `/mnt/ssd` on every boot (it shows the exact line and asks first; `nofail` keeps the Pi booting even without the SSD), and sets HomeNAS to start on boot and restart if it ever crashes. It prints the address and the first-time setup code at the end.

**5. Set up.** Open `http://homenas.local:4300` from a laptop, enter the setup code, and pick a folder on the SSD such as `/mnt/ssd/HomeNAS`. The wizard refuses network mounts and warns if a folder is on the SD card rather than the SSD. If the SSD already holds HomeNAS from the PC, it says “Existing HomeNAS storage found”. Connect it and sign in with your existing account.

**Phones:** in the router, give the Pi a fixed address. If you are moving from the PC, reserve **the same address the PC had** for the Pi, and the phones’ shortcuts keep working without any change.

**Day to day**

```
sudo systemctl status homenas     # running?
sudo journalctl -u homenas -f     # live log, including the setup code
sudo systemctl restart homenas    # after copying in a new version
sudo mount -a                     # after unplugging and re-plugging the SSD
```

## Where everything lives

Everything is on the SSD, in the folder you chose:

```
D:\HomeNAS\
  users\<username>\     each person's private files
  shared\<folder>\      shared folders
  .homenas\             database, thumbnails, trash, upload temp files (do not edit)
```

The PC only keeps `data\config.json`, which says where that folder is. Plug the SSD into another PC running HomeNAS, point the setup wizard at the folder, and users, shares and phone bookmarks all come with it. If Windows gives the SSD a new drive letter, the “drive not connected” page lets you point HomeNAS at the new location.

Unplug the SSD and HomeNAS goes into a “drive not connected” state within seconds, then resumes when the drive returns. It never writes to the path while the drive is missing, so it cannot quietly fill the PC’s own disk.

Files you copy onto the SSD directly (with Explorer) are picked up within seconds.

## Security

- Passwords are hashed with scrypt. Session, phone and share tokens are random, and only their hashes are stored (share link tokens excepted, so you can copy a link again).
- Logins, phone tokens, setup codes and share-link passwords are rate-limited.
- Each person’s *My files* is private, **including from admins**. Shared folders have per-person view-only or edit access. Only people with edit access can create public links.
- Every path is checked so it cannot escape its folder (`..`, symlinks and junctions, Windows reserved names, NTFS alternate data streams).
- Uploaded HTML, SVG and scripts are never served as live pages. They open as plain text or download, under a sandboxing Content-Security-Policy, so a shared file cannot take over someone’s session.
- Changes require a custom header, which blocks cross-site form attacks. The interface loads nothing from the internet.
- First-run setup works only from the PC itself, or with a 6-digit code printed in the HomeNAS window.

**The connection is plain HTTP.** That is normal for a home network protected by WPA2/WPA3, but do not open the port on your router. For access away from home, install **Tailscale** on the PC and the phones. It encrypts everything and HomeNAS shows the Tailscale address automatically. Share links only work for people on your network or Tailscale.

## HomeNAS is not a backup of itself

Everything is on one SSD. If that drive fails, is stolen or is dropped, everything on it is gone. Keep a second copy of the `HomeNAS` folder on another drive or in the cloud (for example a weekly copy with `robocopy D:\HomeNAS E:\HomeNAS-copy /MIR`). Use “Safely Remove” before unplugging. NTFS is more robust than exFAT; FAT32 cannot hold files over 4 GB.

## Known limits

- **Video playback** depends on the browser. iPhone videos are usually HEVC, which Safari and Edge (with the HEVC extension) play and Chrome and Firefox often do not. Downloads always work. HomeNAS does not transcode.
- **HEIC thumbnails** use a WebAssembly decoder (libheif). They are tested with the code path but not yet with a real iPhone photo: upload one to check.
- Uploads from a browser are not resumable: a broken connection restarts that file (phone backups resume per photo).
- The storage folder’s own path must be short (under 200 characters), because the database cannot live deeper. Your files inside it can be as deep as you like.
- Per-user quotas, file versioning and SMB/Windows file sharing are not built in yet.

## Development

```
npm install
npm run dev          # http://localhost:4300 with live reload (uses data/config.json)
npm test             # 44 tests: paths, sync rules, API, phone and files backup, media, background workers, Linux drives
npm run typecheck
npm run build        # web interface into dist/
npm start            # production server
```

`node server/index.ts --config data/dev-config.json --port 4390` runs a separate instance with its own storage, which is handy for experiments.

Node runs the TypeScript directly, with no build step for the server. The server is Express 5 and `node:sqlite`; sharp and heic-decode make thumbnails, exifr reads metadata, and ffmpeg is optional. The web interface is React 19, Vite and Tailwind 4.

```
server/
  index.ts        startup, ports, timeouts
  app.ts          middleware and routes
  runtime.ts      setup / online / offline state, drive monitoring
  volume.ts       drive marker, disk space, drive types
  db.ts           schema and migrations
  auth.ts         passwords, sessions, CSRF, rate limits
  spaces.ts       private and shared folders, access rules
  paths.ts        path safety and Windows-safe names
  indexer.ts      file index, periodic scans, live watching
  media.ts        hashing, EXIF/ffprobe metadata, thumbnails
  sync.ts         phone backup bookmark rules
  upload.ts       streaming uploads
  routes/         files, trash, devices, shares, admin, events
src/              the web interface
tests/            node:test suites
```
