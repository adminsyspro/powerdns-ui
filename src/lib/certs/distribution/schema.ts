import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getCertsDir } from '../config';
import { resolvePath } from './providers/infisical-secrets';
import { trimTrailingSlashes, asString } from './text';

type Db = Database.Database;

export const FILESYSTEM_DEFAULT_ID = 'filesystem-default';
export const INFISICAL_DEFAULT_ID = 'infisical-default';

/**
 * Distribution tables + one-shot migration of the legacy singleton
 * `infisical_config` and of the implicit "always materialize" behaviour.
 *
 * Kept dependency-free (no crypto, no providers) so `initSchema` can call it.
 * Idempotent: guarded by the presence of the default filesystem connection.
 */
export function migrateDistribution(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS distribution_connections (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      type          TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      config_json   TEXT NOT NULL DEFAULT '{}',
      secret_enc    TEXT NOT NULL DEFAULT '',
      auto_attach   INTEGER NOT NULL DEFAULT 0,
      default_target_json TEXT DEFAULT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS certificate_distributions (
      id                    TEXT PRIMARY KEY,
      certificate_id        TEXT NOT NULL,
      connection_id         TEXT NOT NULL,
      origin                TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('auto','manual')),
      target_json           TEXT NOT NULL DEFAULT '{}',
      published_target_json TEXT DEFAULT NULL,
      published_fingerprint TEXT DEFAULT NULL,
      published_at          INTEGER DEFAULT NULL,
      last_error            TEXT DEFAULT NULL,
      last_attempt_at       INTEGER DEFAULT NULL,
      attempts              INTEGER NOT NULL DEFAULT 0,
      next_attempt_at       INTEGER DEFAULT NULL,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cert_dist_cert ON certificate_distributions(certificate_id);
    CREATE INDEX IF NOT EXISTS idx_cert_dist_conn ON certificate_distributions(connection_id);
    -- One auto distribution per (certificate, connection).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_dist_auto
      ON certificate_distributions(certificate_id, connection_id) WHERE origin = 'auto';
  `);

  const already = db.prepare('SELECT 1 FROM distribution_connections WHERE id = ?').get(FILESYSTEM_DEFAULT_ID);
  if (already) return;

  db.transaction(() => {
    // 1. Filesystem: today every issued cert is materialized → auto-attached connection.
    db.prepare(
      `INSERT INTO distribution_connections (id, name, type, enabled, config_json, auto_attach, default_target_json)
       VALUES (?, 'Local disk', 'filesystem', 1, '{}', 1, '{}')`,
    ).run(FILESYSTEM_DEFAULT_ID);
    // 2. Infisical singleton → connection + auto-attached default target.
    const infisicalTarget = migrateInfisicalConfig(db);
    // 3. One auto distribution per (certificate × default connection), with its publish state.
    migrateCertificates(db, infisicalTarget);
  })();
}

interface LegacyTarget { projectId: string; environment: string; path: string }

interface LegacyCertRow {
  id: string;
  name: string;
  category: string | null;
  fingerprint_sha256: string | null;
  last_issued_at: number | null;
  materialized_at: number | null;
  infisical_synced_at: number | null;
}

function hasTable(db: Db, t: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
}

/** Legacy singleton → "Infisical" connection. Returns its target, or null when Infisical was never configured. */
function migrateInfisicalConfig(db: Db): LegacyTarget | null {
  if (!hasTable(db, 'infisical_config')) return null;
  const row = db.prepare('SELECT * FROM infisical_config WHERE id = 1').get() as any;
  if (!row?.site_url) return null;
  const base = trimTrailingSlashes(asString(row.secret_base_path) || '/ssl');
  const target: LegacyTarget = { projectId: row.project_id, environment: row.environment, path: `${base}/{category}/{name}` };
  db.prepare(
    `INSERT INTO distribution_connections
       (id, name, type, enabled, config_json, secret_enc, auto_attach, default_target_json)
     VALUES (?, 'Infisical', 'infisical-secrets', ?, ?, ?, 1, ?)`,
  ).run(
    INFISICAL_DEFAULT_ID,
    row.enabled ? 1 : 0,
    JSON.stringify({ siteUrl: trimTrailingSlashes(asString(row.site_url)), clientId: row.client_id }),
    row.client_secret_enc || '',
    JSON.stringify(target),
  );
  return target;
}

/**
 * Only claim "already published" when the last publish happened after the last
 * issuance — a stale copy (e.g. a renewal whose sync failed) stays pending so
 * the reconciler republishes it.
 */
function isFresh(c: LegacyCertRow, publishedAt: number | null): boolean {
  if (publishedAt == null || !c.fingerprint_sha256) return false;
  return c.last_issued_at == null || publishedAt >= c.last_issued_at;
}

function migrateCertificates(db: Db, infisicalTarget: LegacyTarget | null): void {
  if (!hasTable(db, 'certificates')) return;
  const certCols = (db.prepare('PRAGMA table_info(certificates)').all() as Array<{ name: string }>).map((c) => c.name);
  const syncedCol = certCols.includes('infisical_synced_at') ? 'infisical_synced_at' : 'NULL AS infisical_synced_at';
  const certs = db.prepare(
    `SELECT id, name, category, fingerprint_sha256, last_issued_at, materialized_at, ${syncedCol} FROM certificates`,
  ).all() as LegacyCertRow[];

  const ins = db.prepare(
    `INSERT INTO certificate_distributions
       (id, certificate_id, connection_id, origin, target_json, published_target_json, published_fingerprint, published_at)
     VALUES (?, ?, ?, 'auto', '{}', ?, ?, ?)`,
  );
  // The legacy location is recorded whenever something was ever written there,
  // so a later move removes the old copy instead of leaving a private key behind.
  const insert = (c: LegacyCertRow, connectionId: string, location: object | null, publishedAt: number | null) => {
    const fresh = isFresh(c, publishedAt);
    ins.run(randomUUID(), c.id, connectionId, location ? JSON.stringify(location) : null,
      fresh ? c.fingerprint_sha256 : null, fresh ? publishedAt : null);
  };

  for (const c of certs) {
    const fsLocation = c.materialized_at == null ? null : { dir: getCertsDir(), name: String(c.name).toLowerCase() };
    insert(c, FILESYSTEM_DEFAULT_ID, fsLocation, c.materialized_at);
    if (!infisicalTarget) continue;
    const infLocation = c.infisical_synced_at == null ? null : {
      projectId: infisicalTarget.projectId,
      environment: infisicalTarget.environment,
      path: resolvePath(infisicalTarget.path, { name: c.name, category: c.category ?? null }),
    };
    insert(c, INFISICAL_DEFAULT_ID, infLocation, c.infisical_synced_at);
  }
}
