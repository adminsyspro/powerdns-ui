import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'data', 'cache.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id              TEXT NOT NULL,
      server_url      TEXT NOT NULL,
      name            TEXT NOT NULL,
      url             TEXT,
      kind            TEXT NOT NULL,
      dnssec          INTEGER NOT NULL DEFAULT 0,
      account         TEXT DEFAULT '',
      serial          INTEGER DEFAULT 0,
      edited_serial   INTEGER DEFAULT 0,
      notified_serial INTEGER DEFAULT 0,
      last_check      INTEGER DEFAULT 0,
      PRIMARY KEY (server_url, id)
    );

    CREATE INDEX IF NOT EXISTS idx_zones_server ON zones(server_url);
    CREATE INDEX IF NOT EXISTS idx_zones_name ON zones(server_url, name);
    CREATE INDEX IF NOT EXISTS idx_zones_kind ON zones(server_url, kind);

    CREATE TABLE IF NOT EXISTS sync_meta (
      server_url       TEXT PRIMARY KEY,
      last_sync_at     INTEGER NOT NULL,
      zone_count       INTEGER NOT NULL DEFAULT 0,
      sync_duration_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS change_history (
      id              TEXT PRIMARY KEY,
      server_url      TEXT NOT NULL,
      zone_id         TEXT NOT NULL,
      zone_name       TEXT NOT NULL,
      changes_json    TEXT NOT NULL,
      reason          TEXT DEFAULT '',
      user            TEXT DEFAULT 'admin',
      submitted_at    INTEGER NOT NULL,
      status          TEXT NOT NULL,
      error_message   TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_change_history_zone ON change_history(server_url, zone_id);
    CREATE INDEX IF NOT EXISTS idx_change_history_time ON change_history(submitted_at DESC);
  `);
}
