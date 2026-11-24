import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getCertsDir } from '../config';
import { resolvePath } from './providers/infisical-secrets';

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

  const hasTable = (t: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

  db.transaction(() => {
    // 1. Filesystem: today every issued cert is materialized → auto-attached connection.
    db.prepare(
      `INSERT INTO distribution_connections (id, name, type, enabled, config_json, auto_attach, default_target_json)
       VALUES (?, 'Local disk', 'filesystem', 1, '{}', 1, '{}')`,
    ).run(FILESYSTEM_DEFAULT_ID);

    // 2. Infisical singleton → connection + auto-attached default target.
    let infisical: any = null;
    let infisicalTarget: { projectId: string; environment: string; path: string } | null = null;
    if (hasTable('infisical_config')) {
      infisical = db.prepare('SELECT * FROM infisical_config WHERE id = 1').get();
    }
    if (infisical && infisical.site_url) {
      const base = String(infisical.secret_base_path || '/ssl').replace(/\/+$/, '');
      const pathTemplate = `${base}/{category}/{name}`;
      infisicalTarget = { projectId: infisical.project_id, environment: infisical.environment, path: pathTemplate };
      db.prepare(
        `INSERT INTO distribution_connections
           (id, name, type, enabled, config_json, secret_enc, auto_attach, default_target_json)
         VALUES (?, 'Infisical', 'infisical-secrets', ?, ?, ?, 1, ?)`,
      ).run(
        INFISICAL_DEFAULT_ID,
        infisical.enabled ? 1 : 0,
        JSON.stringify({ siteUrl: String(infisical.site_url).replace(/\/+$/, ''), clientId: infisical.client_id }),
        infisical.client_secret_enc || '',
        JSON.stringify(infisicalTarget),
      );
    }

    if (!hasTable('certificates')) return;
    const certCols = (db.prepare('PRAGMA table_info(certificates)').all() as Array<{ name: string }>).map((c) => c.name);
    const hasSynced = certCols.includes('infisical_synced_at');
    const certs = db.prepare(
      `SELECT id, name, category, fingerprint_sha256, last_issued_at, materialized_at
              ${hasSynced ? ', infisical_synced_at' : ', NULL AS infisical_synced_at'}
         FROM certificates`,
    ).all() as any[];

    const ins = db.prepare(
      `INSERT INTO certificate_distributions
         (id, certificate_id, connection_id, origin, target_json, published_target_json, published_fingerprint, published_at)
       VALUES (?, ?, ?, 'auto', '{}', ?, ?, ?)`,
    );
    for (const c of certs) {
      // Only claim "already published" when the last publish happened after the
      // last issuance — a stale copy (e.g. a renewal whose sync failed) stays
      // pending so the reconciler republishes it. The legacy location is recorded
      // whenever something was ever written there, so a later move (category
      // change) removes the old copy instead of leaving a private key behind.
      const fresh = (at: number | null) =>
        !!(at != null && c.fingerprint_sha256 && (c.last_issued_at == null || at >= c.last_issued_at));

      const fsTarget = c.materialized_at != null
        ? JSON.stringify({ dir: getCertsDir(), name: String(c.name).toLowerCase() })
        : null;
      ins.run(randomUUID(), c.id, FILESYSTEM_DEFAULT_ID, fsTarget,
        fresh(c.materialized_at) ? c.fingerprint_sha256 : null, fresh(c.materialized_at) ? c.materialized_at : null);

      if (infisicalTarget) {
        const infTarget = c.infisical_synced_at != null
          ? JSON.stringify({
              projectId: infisicalTarget.projectId,
              environment: infisicalTarget.environment,
              path: resolvePath(infisicalTarget.path, { name: c.name, category: c.category ?? null }),
            })
          : null;
        ins.run(randomUUID(), c.id, INFISICAL_DEFAULT_ID, infTarget,
          fresh(c.infisical_synced_at) ? c.fingerprint_sha256 : null, fresh(c.infisical_synced_at) ? c.infisical_synced_at : null);
      }
    }
  })();
}
