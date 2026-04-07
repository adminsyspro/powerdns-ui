import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { seedDefaultAdmin } from '@/lib/auth/seed';

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

    CREATE TABLE IF NOT EXISTS server_connections (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL,
      api_key         TEXT NOT NULL,
      version         TEXT DEFAULT NULL,
      is_default      INTEGER NOT NULL DEFAULT 0,
      last_connected  INTEGER DEFAULT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      username        TEXT NOT NULL UNIQUE,
      email           TEXT NOT NULL,
      firstname       TEXT DEFAULT '',
      lastname        TEXT DEFAULT '',
      role            TEXT NOT NULL DEFAULT 'User' CHECK(role IN ('Administrator','Operator','User')),
      active          INTEGER NOT NULL DEFAULT 1,
      password_hash   TEXT DEFAULT NULL,
      avatar          TEXT DEFAULT NULL,
      auth_type       TEXT NOT NULL DEFAULT 'local' CHECK(auth_type IN ('local','ldap')),
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Proxy: environments (API consumers with token-based auth)
    CREATE TABLE IF NOT EXISTS proxy_environments (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      description     TEXT DEFAULT '',
      token_sha512    TEXT NOT NULL,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_proxy_env_token ON proxy_environments(token_sha512);

    -- Proxy: zone-level permissions per environment
    CREATE TABLE IF NOT EXISTS proxy_zone_permissions (
      id              TEXT PRIMARY KEY,
      environment_id  TEXT NOT NULL REFERENCES proxy_environments(id) ON DELETE CASCADE,
      zone_name       TEXT NOT NULL,
      acme_enabled    INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(environment_id, zone_name)
    );
    CREATE INDEX IF NOT EXISTS idx_proxy_zone_env ON proxy_zone_permissions(environment_id);

    -- Proxy: record-level filtering rules per zone permission
    CREATE TABLE IF NOT EXISTS proxy_record_rules (
      id              TEXT PRIMARY KEY,
      zone_perm_id    TEXT NOT NULL REFERENCES proxy_zone_permissions(id) ON DELETE CASCADE,
      rule_type       TEXT NOT NULL CHECK(rule_type IN ('exact', 'regex')),
      pattern         TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_proxy_record_zone ON proxy_record_rules(zone_perm_id);

    -- Proxy: request logs
    CREATE TABLE IF NOT EXISTS proxy_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       INTEGER NOT NULL DEFAULT (unixepoch()),
      environment_id  TEXT,
      environment_name TEXT,
      method          TEXT NOT NULL,
      path            TEXT NOT NULL,
      zone            TEXT,
      status          INTEGER NOT NULL,
      ip              TEXT DEFAULT '',
      user_agent      TEXT DEFAULT '',
      duration_ms     INTEGER DEFAULT 0,
      error           TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_proxy_logs_time ON proxy_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_proxy_logs_env ON proxy_logs(environment_id);
  `);

  // Migrations — add columns that may not exist in older databases
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes('avatar')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL');
  }

  // Migration: remove server_id from proxy_environments (now global)
  const proxyCols = db.prepare("PRAGMA table_info(proxy_environments)").all() as Array<{ name: string }>;
  const proxyColNames = proxyCols.map((c) => c.name);
  if (proxyColNames.includes('server_id')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS proxy_environments_new (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL UNIQUE,
        description     TEXT DEFAULT '',
        token_sha512    TEXT NOT NULL,
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT OR IGNORE INTO proxy_environments_new (id, name, description, token_sha512, active, created_at, updated_at)
        SELECT id, name, description, token_sha512, active, created_at, updated_at FROM proxy_environments;
      DROP TABLE proxy_environments;
      ALTER TABLE proxy_environments_new RENAME TO proxy_environments;
      CREATE INDEX IF NOT EXISTS idx_proxy_env_token ON proxy_environments(token_sha512);
    `);
  }

  // Migration: add request_body column to proxy_logs
  const logCols = db.prepare("PRAGMA table_info(proxy_logs)").all() as Array<{ name: string }>;
  const logColNames = logCols.map((c) => c.name);
  if (!logColNames.includes('request_body')) {
    db.exec('ALTER TABLE proxy_logs ADD COLUMN request_body TEXT DEFAULT NULL');
  }

  seedDefaultAdmin(db);
}
