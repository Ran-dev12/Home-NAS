import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadConfig, saveConfig, type AppConfig } from './config.ts';
import { openDb, getSetting, setSetting, type Db } from './db.ts';
import { readMarker, volumePaths, ensureVolumeDirs, type VolumeMarker } from './volume.ts';
import { EventHub } from './events.ts';
import { Indexer } from './indexer.ts';
import { MediaQueue } from './media.ts';
import { HttpError } from './http.ts';
import { runMaintenance } from './maintenance.ts';

export interface Settings {
  serverName: string;
  /** Base URL phones and share links should use, e.g. http://192.168.1.20:4300. Empty = auto-detect. */
  publicUrl: string;
  trashDays: number;
  maxUploadGb: number;
  /** Uploads are refused once free space would drop below this. */
  minFreeGb: number;
  scanMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  serverName: 'HomeNAS',
  publicUrl: '',
  trashDays: 30,
  maxUploadGb: 100,
  minFreeGb: 2,
  scanMinutes: 30,
};

export type RuntimeState = 'setup' | 'offline' | 'online';

export interface RuntimeOptions {
  appDir: string;
  configPath: string;
  prod: boolean;
  quiet?: boolean;
  /** How often to check the drive is still attached. */
  monitorMs?: number;
  /** Tests turn off the background scanner and thumbnailer to stay deterministic. */
  background?: boolean;
}

function findTool(name: string): string | null {
  const override = process.env[`HOMENAS_${name.toUpperCase()}`];
  const candidate = override || name;
  try {
    const r = spawnSync(candidate, ['-version'], { windowsHide: true, timeout: 5000 });
    return r.status === 0 ? candidate : null;
  } catch {
    return null;
  }
}

/** libheif's command-line decoder (Linux: apt install libheif-examples). Named heif-dec from 1.17, heif-convert before. */
function findHeifDecoder(): string | null {
  for (const candidate of [process.env.HOMENAS_HEIF_DEC, 'heif-dec', 'heif-convert']) {
    if (!candidate) continue;
    try {
      // Exit codes for --help differ between versions; the only question is whether the program exists.
      const r = spawnSync(candidate, ['--help'], { windowsHide: true, timeout: 5000 });
      if (!r.error) return candidate;
    } catch {
      /* not installed */
    }
  }
  return null;
}

export class Runtime {
  appDir: string;
  configPath: string;
  prod: boolean;
  config: AppConfig;
  state: RuntimeState = 'setup';
  offlineReason = '';
  db: Db | null = null;
  marker: VolumeMarker | null = null;
  secret: Buffer = Buffer.alloc(0);
  setupCode = crypto.randomInt(100000, 1000000).toString();
  events = new EventHub();
  indexer: Indexer;
  media: MediaQueue;
  tools: { ffmpeg: string | null; ffprobe: string | null; heifDec: string | null };
  startedAt = Date.now();
  quiet: boolean;
  background: boolean;
  private monitorMs: number;
  private monitor?: NodeJS.Timeout;
  private misses = 0;
  private timers: NodeJS.Timeout[] = [];
  private settingsCache: Settings | null = null;

  constructor(opts: RuntimeOptions) {
    this.appDir = opts.appDir;
    this.configPath = opts.configPath;
    this.prod = opts.prod;
    this.quiet = !!opts.quiet;
    this.background = opts.background !== false;
    this.monitorMs = opts.monitorMs ?? 5000;
    this.config = loadConfig(opts.configPath);
    this.indexer = new Indexer(this);
    this.media = new MediaQueue(this);
    this.tools = { ffmpeg: findTool('ffmpeg'), ffprobe: findTool('ffprobe'), heifDec: findHeifDecoder() };
  }

  log(...args: unknown[]) {
    if (!this.quiet) console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
  }

  get root(): string {
    if (!this.config.storageRoot) throw new HttpError(503, 'setup_required', 'HomeNAS has not been set up yet');
    return this.config.storageRoot;
  }

  get paths() {
    return volumePaths(this.root);
  }

  requireDb(): Db {
    if (this.state === 'setup') throw new HttpError(503, 'setup_required', 'HomeNAS has not been set up yet');
    if (this.state !== 'online' || !this.db) {
      throw new HttpError(503, 'storage_offline', 'The storage drive is not connected. Plug it in and wait a few seconds.');
    }
    return this.db;
  }

  boot() {
    if (!this.config.storageRoot) {
      this.state = 'setup';
      return;
    }
    this.tryOnline();
    this.startMonitor();
  }

  /** Called by setup once the volume is initialised. */
  attach(root: string) {
    this.config.storageRoot = root;
    saveConfig(this.configPath, this.config);
    if (!this.tryOnline()) throw new Error(`Could not open the HomeNAS volume at ${root}`);
    this.startMonitor();
  }

  tryOnline(): boolean {
    const root = this.config.storageRoot;
    if (!root) return false;
    const marker = readMarker(root);
    if (!marker) {
      this.setOffline(`No HomeNAS volume found at ${root}`);
      return false;
    }
    try {
      ensureVolumeDirs(root);
      this.db = openDb(volumePaths(root).db);
      let secret = getSetting(this.db, 'secret');
      if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        setSetting(this.db, 'secret', secret);
      }
      this.secret = Buffer.from(secret, 'hex');
      this.marker = marker;
      this.settingsCache = null;
      this.state = 'online';
      this.offlineReason = '';
      this.misses = 0;
      this.log(`Storage online: ${root} (${marker.name})`);
      if (this.background) {
        this.indexer.start();
        this.media.start();
        this.timers.push(setTimeout(() => this.maintenance(), 15_000));
        this.timers.push(setInterval(() => this.maintenance(), 6 * 3600_000));
      }
      this.events.emit('state', { state: 'online' }, { all: true });
      return true;
    } catch (err) {
      this.log('Failed to open storage:', err);
      try {
        this.db?.close();
      } catch {
        /* ignore */
      }
      this.db = null;
      this.setOffline(`Could not open the database on the drive: ${(err as Error).message}`);
      return false;
    }
  }

  private setOffline(reason: string) {
    const wasOnline = this.state === 'online';
    this.state = 'offline';
    this.offlineReason = reason;
    if (wasOnline) this.log(`Storage offline: ${reason}`);
  }

  goOffline(reason: string) {
    this.indexer.stop();
    this.media.stop();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    try {
      this.db?.close();
    } catch {
      /* the drive may already be gone */
    }
    this.db = null;
    this.setOffline(reason);
    this.events.emit('state', { state: 'offline', reason }, { all: true });
    this.events.closeAll();
  }

  private startMonitor() {
    if (this.monitor) return;
    this.monitor = setInterval(() => this.checkVolume(), this.monitorMs);
    this.monitor.unref();
  }

  checkVolume() {
    const root = this.config.storageRoot;
    if (!root) return;
    const m = readMarker(root);
    if (this.state === 'online') {
      if (m && this.marker && m.id === this.marker.id) {
        this.misses = 0;
        return;
      }
      // Two misses in a row, so one slow read on a busy USB drive does not take everything down.
      if (++this.misses >= 2) {
        this.goOffline(m ? 'A different HomeNAS drive was connected' : 'The storage drive was disconnected');
        if (m) this.tryOnline();
      }
    } else if (this.state === 'offline' && m) {
      this.tryOnline();
    }
  }

  private maintenance() {
    runMaintenance(this).catch((err) => this.log('Maintenance failed:', err));
  }

  settings(): Settings {
    if (this.settingsCache) return this.settingsCache;
    const raw = getSetting(this.requireDb(), 'app');
    let stored: Partial<Settings> = {};
    try {
      stored = raw ? JSON.parse(raw) : {};
    } catch {
      stored = {};
    }
    this.settingsCache = { ...DEFAULT_SETTINGS, ...stored };
    return this.settingsCache;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    setSetting(this.requireDb(), 'app', JSON.stringify(next));
    this.settingsCache = next;
    return next;
  }

  hmac(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  async shutdown() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = undefined;
    this.indexer.stop();
    this.media.stop();
    await this.media.idle();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.events.stop();
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }
}
