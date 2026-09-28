import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  /** Absolute path of the storage root (a folder on the external SSD). Null until setup. */
  storageRoot: string | null;
  port: number;
  host: string;
}

const DEFAULTS: AppConfig = { storageRoot: null, port: 4300, host: '0.0.0.0' };

export function loadConfig(configPath: string): AppConfig {
  let fileCfg: Partial<AppConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Config file ${configPath} is not valid JSON: ${(err as Error).message}`);
    }
  }
  const cfg: AppConfig = { ...DEFAULTS, ...fileCfg };
  if (process.env.HOMENAS_PORT) cfg.port = Number(process.env.HOMENAS_PORT);
  if (process.env.HOMENAS_HOST) cfg.host = process.env.HOMENAS_HOST;
  return cfg;
}

export function saveConfig(configPath: string, cfg: AppConfig) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ storageRoot: cfg.storageRoot, port: cfg.port, host: cfg.host }, null, 2));
  fs.renameSync(tmp, configPath);
}
