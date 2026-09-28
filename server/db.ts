import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Each entry runs once, in order; PRAGMA user_version records how far a volume's database has got.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    created_at TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    folder TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE space_members (
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access TEXT NOT NULL CHECK (access IN ('read', 'write')),
    PRIMARY KEY (space_id, user_id)
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    space TEXT NOT NULL,
    path TEXT NOT NULL,
    parent TEXT NOT NULL,
    name TEXT NOT NULL,
    is_dir INTEGER NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    sha256 TEXT,
    taken_at TEXT,
    ts INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    duration REAL,
    lat REAL,
    lon REAL,
    camera TEXT,
    media_state TEXT NOT NULL DEFAULT 'na',
    seen INTEGER NOT NULL DEFAULT 0,
    UNIQUE (space, path)
  );
  CREATE INDEX files_parent ON files(space, parent);
  CREATE INDEX files_sha ON files(space, sha256);
  CREATE INDEX files_timeline ON files(kind, ts);
  CREATE INDEX files_state ON files(media_state);
  CREATE INDEX files_name ON files(name COLLATE NOCASE);

  CREATE TABLE devices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    last_sync_at TEXT,
    cursor TEXT,
    tz_offset INTEGER,
    batch_limit INTEGER NOT NULL DEFAULT 300,
    run_started_at TEXT,
    run_base TEXT,
    run_last TEXT,
    run_max TEXT,
    run_monotonic INTEGER NOT NULL DEFAULT 1,
    run_stored INTEGER NOT NULL DEFAULT 0,
    run_skipped INTEGER NOT NULL DEFAULT 0,
    run_bytes INTEGER NOT NULL DEFAULT 0,
    total_files INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    order_warning INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE share_links (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    space TEXT NOT NULL,
    path TEXT NOT NULL,
    is_dir INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    password_hash TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE trash (
    id TEXT PRIMARY KEY,
    space TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    is_dir INTEGER NOT NULL,
    size INTEGER NOT NULL,
    deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at TEXT NOT NULL
  );

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER,
    device_id INTEGER,
    action TEXT NOT NULL,
    space TEXT,
    path TEXT,
    detail TEXT
  );
  CREATE INDEX activity_at ON activity(at);
  CREATE INDEX activity_user ON activity(user_id, at);
  `,
  `
  -- What each phone backs up. Existing phones keep backing up photos, videos and screenshots.
  ALTER TABLE devices ADD COLUMN backup_photos INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE devices ADD COLUMN backup_videos INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE devices ADD COLUMN backup_screenshots INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE devices ADD COLUMN backup_files INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE devices ADD COLUMN run_excluded INTEGER NOT NULL DEFAULT 0;

  -- Files from the iPhone's Files app. Shortcuts cannot hash, so a file is known by its folder, name and
  -- creation date, and "changed" means its modification date or size text differs from last time.
  CREATE TABLE device_files (
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    name TEXT NOT NULL,
    created TEXT NOT NULL,
    signature TEXT NOT NULL,
    path TEXT NOT NULL,
    backed_up_at TEXT NOT NULL,
    PRIMARY KEY (device_id, folder, name, created)
  );
  `,
];

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Db, key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
