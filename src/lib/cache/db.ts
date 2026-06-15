import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { seedDefaultAdmin } from '@/lib/auth/seed';
import { cryptoSanityCheck } from '@/lib/crypto';

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
      role            TEXT NOT NULL DEFAULT 'User' CHECK(role IN ('Administrator','Operator','Manager','User','Customer')),
      active          INTEGER NOT NULL DEFAULT 1,
      password_hash   TEXT DEFAULT NULL,
      avatar          TEXT DEFAULT NULL,
      auth_type       TEXT NOT NULL DEFAULT 'local' CHECK(auth_type IN ('local','ldap','oidc')),
      oidc_subject    TEXT DEFAULT NULL,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    -- NOTE: idx_users_oidc_subject is created after the users migration below,
    -- not here. On an upgrade the oidc_subject column does not exist yet (the
    -- legacy users table is a no-op for CREATE TABLE IF NOT EXISTS), so creating
    -- the index in this block would abort initSchema with "no such column".

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "groups" (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_groups (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id    TEXT NOT NULL REFERENCES "groups"(id) ON DELETE CASCADE,
      source      TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','ldap','oidc')),
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, group_id, source)
    );

    CREATE INDEX IF NOT EXISTS idx_user_groups_user  ON user_groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups(group_id);

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

    -- NS compliance audit: public delegation of each forward zone compared to
    -- the default nameserver pool (see src/lib/ns-audit.ts).
    CREATE TABLE IF NOT EXISTS ns_audit (
      server_url  TEXT NOT NULL,
      zone_id     TEXT NOT NULL,
      zone_name   TEXT NOT NULL,
      status      TEXT NOT NULL,
      delegated   TEXT NOT NULL DEFAULT '[]',
      in_pool     TEXT NOT NULL DEFAULT '[]',
      extra       TEXT NOT NULL DEFAULT '[]',
      missing     TEXT NOT NULL DEFAULT '[]',
      error       TEXT DEFAULT NULL,
      checked_at  INTEGER NOT NULL,
      PRIMARY KEY (server_url, zone_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ns_audit_status ON ns_audit(server_url, status);

    -- External provider integrations (e.g. Cloudflare secondary DNS).
    -- credentials is encrypted with APP_SECRET like other stored secrets.
    CREATE TABLE IF NOT EXISTS integrations (
      id              TEXT PRIMARY KEY,
      provider        TEXT NOT NULL,
      name            TEXT NOT NULL,
      credentials     TEXT NOT NULL,
      config          TEXT NOT NULL DEFAULT '{}',
      connection_id   TEXT DEFAULT NULL,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Per-zone replication state for an integration, scoped by PowerDNS
    -- server so identical zone names on different connections never conflate.
    CREATE TABLE IF NOT EXISTS integration_zones (
      integration_id  TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      server_url      TEXT NOT NULL,
      zone_name       TEXT NOT NULL,
      remote_zone_id  TEXT DEFAULT NULL,
      status          TEXT NOT NULL,
      message         TEXT DEFAULT NULL,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (integration_id, server_url, zone_name)
    );
    CREATE INDEX IF NOT EXISTS idx_integration_zones_status ON integration_zones(integration_id, status);

    -- Single-row advisory lease so only one process runs the reconcile loop
    -- (guards against accidental multi-start; single-process is the norm).
    CREATE TABLE IF NOT EXISTS worker_lease (
      id         TEXT PRIMARY KEY,
      owner      TEXT NOT NULL,
      heartbeat  INTEGER NOT NULL
    );
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

  // Migration: bind each integration to a PowerDNS connection. Backfill existing
  // rows to the default connection (is_default, else oldest) so upgrades keep
  // working. New integrations set it explicitly via the API.
  const intCols = db.prepare("PRAGMA table_info(integrations)").all() as Array<{ name: string }>;
  if (!intCols.some((c) => c.name === 'connection_id')) {
    db.exec('ALTER TABLE integrations ADD COLUMN connection_id TEXT DEFAULT NULL');
    const def = db
      .prepare('SELECT id FROM server_connections ORDER BY is_default DESC, created_at ASC LIMIT 1')
      .get() as { id: string } | undefined;
    if (def) {
      db.prepare('UPDATE integrations SET connection_id = ? WHERE connection_id IS NULL').run(def.id);
    }
  }

  // Migration: extend users.role CHECK to include 'Customer', users.auth_type
  // CHECK to include 'oidc', and add oidc_subject + session_version columns.
  // SQLite cannot ALTER a CHECK in place, so rebuild the table when the stored
  // CREATE statement does not yet mention 'Customer'.
  const usersSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as
      | { sql: string }
      | undefined)?.sql ?? '';
  if (!usersSql.includes("'Customer'")) {
    db.exec(`
      DROP TABLE IF EXISTS users_new;
      CREATE TABLE users_new (
        id              TEXT PRIMARY KEY,
        username        TEXT NOT NULL UNIQUE,
        email           TEXT NOT NULL,
        firstname       TEXT DEFAULT '',
        lastname        TEXT DEFAULT '',
        role            TEXT NOT NULL DEFAULT 'User' CHECK(role IN ('Administrator','Operator','User','Customer')),
        active          INTEGER NOT NULL DEFAULT 1,
        password_hash   TEXT DEFAULT NULL,
        avatar          TEXT DEFAULT NULL,
        auth_type       TEXT NOT NULL DEFAULT 'local' CHECK(auth_type IN ('local','ldap','oidc')),
        oidc_subject    TEXT DEFAULT NULL,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO users_new
        (id, username, email, firstname, lastname, role, active, password_hash, avatar, auth_type, oidc_subject, session_version, created_at, updated_at)
        SELECT id, username, email, firstname, lastname, role, active, password_hash, avatar, auth_type, NULL, 0, created_at, updated_at
          FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
  }

  // Migration: extend users.role CHECK to allow 'Manager' (a group-scoped
  // technician role). Re-read the stored CREATE (the 'Customer' migration just
  // above may have rebuilt the table) and rebuild again if 'Manager' is not yet
  // permitted. SQLite cannot ALTER a CHECK in place, so rebuild the table.
  const usersSqlMgr =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as
      | { sql: string }
      | undefined)?.sql ?? '';
  if (!usersSqlMgr.includes("'Manager'")) {
    db.exec(`
      DROP TABLE IF EXISTS users_new;
      CREATE TABLE users_new (
        id              TEXT PRIMARY KEY,
        username        TEXT NOT NULL UNIQUE,
        email           TEXT NOT NULL,
        firstname       TEXT DEFAULT '',
        lastname        TEXT DEFAULT '',
        role            TEXT NOT NULL DEFAULT 'User' CHECK(role IN ('Administrator','Operator','Manager','User','Customer')),
        active          INTEGER NOT NULL DEFAULT 1,
        password_hash   TEXT DEFAULT NULL,
        avatar          TEXT DEFAULT NULL,
        auth_type       TEXT NOT NULL DEFAULT 'local' CHECK(auth_type IN ('local','ldap','oidc')),
        oidc_subject    TEXT DEFAULT NULL,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO users_new
        (id, username, email, firstname, lastname, role, active, password_hash, avatar, auth_type, oidc_subject, session_version, created_at, updated_at)
        SELECT id, username, email, firstname, lastname, role, active, password_hash, avatar, auth_type, oidc_subject, session_version, created_at, updated_at
          FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
  }

  // Create the partial unique index on oidc_subject HERE, after the users
  // migration. By this point the column is guaranteed to exist on both paths:
  // fresh installs created it in the CREATE TABLE above, and upgrades added it
  // via the rebuild. Doing it inside the main schema block would crash existing
  // deployments with "no such column: oidc_subject".
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_subject ON users(oidc_subject) WHERE oidc_subject IS NOT NULL;'
  );

  seedDefaultAdmin(db);

  const sanity = cryptoSanityCheck(db);
  if (!sanity.ok) {
    console.warn(`[crypto] ${sanity.message}`);
  }
}
