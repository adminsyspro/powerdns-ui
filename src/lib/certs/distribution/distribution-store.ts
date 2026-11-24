import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { getProvider } from './registry';
import { getConnection } from './connection-store';
import type {
  CertificateDistribution, DistributionConnection, DistributionStatus, ProviderType, ResolvedTarget, TargetSpec,
} from './types';

type Db = Database.Database;

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** Order-insensitive structural equality for small JSON objects. */
export function sameTarget(a: ResolvedTarget | null, b: ResolvedTarget | null): boolean {
  if (!a || !b) return a === b;
  const norm = (o: ResolvedTarget) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return norm(a) === norm(b);
}

/** Raw row joined with what the reconciler needs about the connection and the certificate. */
export interface DistributionRow {
  id: string;
  certificate_id: string;
  connection_id: string;
  origin: 'auto' | 'manual';
  target_json: string;
  published_target_json: string | null;
  published_fingerprint: string | null;
  published_at: number | null;
  last_error: string | null;
  last_attempt_at: number | null;
  attempts: number;
  next_attempt_at: number | null;
  created_at: number;
  // joined
  conn_name: string;
  conn_type: ProviderType;
  conn_enabled: number;
  conn_config_json: string;
  conn_default_target_json: string | null;
  cert_name: string;
  cert_category: string | null;
  cert_fingerprint: string | null;
  cert_has_pem: number;
}

const JOINED = `
  SELECT d.*, c.name AS conn_name, c.type AS conn_type, c.enabled AS conn_enabled,
         c.config_json AS conn_config_json, c.default_target_json AS conn_default_target_json,
         ct.name AS cert_name, ct.category AS cert_category, ct.fingerprint_sha256 AS cert_fingerprint,
         (ct.cert_pem IS NOT NULL) AS cert_has_pem
    FROM certificate_distributions d
    JOIN distribution_connections c ON c.id = d.connection_id
    JOIN certificates ct ON ct.id = d.certificate_id`;

export function getDistributionRow(id: string, db: Db = getDb()): DistributionRow | undefined {
  return db.prepare(`${JOINED} WHERE d.id = ?`).get(id) as DistributionRow | undefined;
}

export function listDistributionRows(certificateId?: string, db: Db = getDb()): DistributionRow[] {
  return (certificateId
    ? db.prepare(`${JOINED} WHERE d.certificate_id = ? ORDER BY d.origin, c.name, d.created_at`).all(certificateId)
    : db.prepare(`${JOINED} ORDER BY d.certificate_id, d.created_at`).all()) as DistributionRow[];
}

export function listDistributionRowsForConnection(connectionId: string, db: Db = getDb()): DistributionRow[] {
  return db.prepare(`${JOINED} WHERE d.connection_id = ?`).all(connectionId) as DistributionRow[];
}

/** Target spec actually in force: auto rows follow the connection's default target. */
export function effectiveTarget(r: DistributionRow): TargetSpec {
  return r.origin === 'auto'
    ? parseJson<TargetSpec>(r.conn_default_target_json, {})
    : parseJson<TargetSpec>(r.target_json, {});
}

export function resolveRowTarget(r: DistributionRow): ResolvedTarget {
  return getProvider(r.conn_type).resolveTarget(
    effectiveTarget(r),
    { name: r.cert_name, category: r.cert_category },
    parseJson(r.conn_config_json, {}),
  );
}

/** True when the row needs a publish (or a move) to match the certificate as it is now. */
export function isOutOfDate(r: DistributionRow): boolean {
  if (!r.cert_has_pem || !r.cert_fingerprint) return false;
  if (r.published_fingerprint !== r.cert_fingerprint) return true;
  const published = parseJson<ResolvedTarget | null>(r.published_target_json, null);
  return !sameTarget(published, resolveRowTarget(r));
}

export function rowToDistribution(r: DistributionRow): CertificateDistribution {
  let resolved: ResolvedTarget = {};
  let resolveError: string | null = null;
  try { resolved = resolveRowTarget(r); } catch (e) { resolveError = (e as Error).message; }
  let status: DistributionStatus;
  if (!r.conn_enabled) status = 'disabled';
  else if (resolveError || r.last_error) status = 'error';
  else if (r.cert_has_pem && !isOutOfDate(r)) status = 'published';
  else status = 'pending';
  return {
    id: r.id,
    certificateId: r.certificate_id,
    connectionId: r.connection_id,
    connectionName: r.conn_name,
    providerType: r.conn_type,
    origin: r.origin,
    target: effectiveTarget(r),
    resolvedTarget: resolved,
    publishedTarget: parseJson<ResolvedTarget | null>(r.published_target_json, null),
    publishedFingerprint: r.published_fingerprint,
    publishedAt: r.published_at,
    lastError: resolveError ?? r.last_error,
    lastAttemptAt: r.last_attempt_at,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    status,
    createdAt: r.created_at,
  };
}

export interface DistributionSummary {
  total: number;
  published: number;
  pending: number;
  error: number;
  disabled: number;
}

/** Per-certificate counts by status, for list views. */
export function summarizeDistributions(db: Db = getDb()): Map<string, DistributionSummary> {
  const out = new Map<string, DistributionSummary>();
  for (const r of listDistributionRows(undefined, db)) {
    const s = out.get(r.certificate_id) ?? { total: 0, published: 0, pending: 0, error: 0, disabled: 0 };
    s.total++;
    s[rowToDistribution(r).status]++;
    out.set(r.certificate_id, s);
  }
  return out;
}

export function listDistributionsForCertificate(certificateId: string, db: Db = getDb()): CertificateDistribution[] {
  return listDistributionRows(certificateId, db).map(rowToDistribution);
}

/**
 * Make sure every certificate has one auto distribution per auto-attach
 * connection. Idempotent (partial unique index on (certificate, connection) for
 * origin='auto'). Returns the number of rows created.
 */
export function ensureAutoDistributions(db: Db = getDb()): number {
  const res = db.prepare(
    `INSERT OR IGNORE INTO certificate_distributions (id, certificate_id, connection_id, origin, target_json)
     SELECT lower(hex(randomblob(16))), ct.id, c.id, 'auto', '{}'
       FROM certificates ct CROSS JOIN distribution_connections c
      WHERE c.auto_attach = 1
        AND NOT EXISTS (SELECT 1 FROM certificate_distributions d
                         WHERE d.certificate_id = ct.id AND d.connection_id = c.id AND d.origin = 'auto')`,
  ).run();
  return res.changes;
}

export function addManualDistribution(
  input: { certificateId: string; connectionId: string; target: unknown },
  db: Db = getDb(),
): CertificateDistribution {
  const conn: DistributionConnection | undefined = getConnection(input.connectionId, db);
  if (!conn) throw new Error('connection not found');
  const cert = db.prepare('SELECT name, category FROM certificates WHERE id = ?').get(input.certificateId) as
    | { name: string; category: string | null }
    | undefined;
  if (!cert) throw new Error('certificate not found');
  const provider = getProvider(conn.type);
  const target = provider.normalizeTarget(input.target);
  const resolved = provider.resolveTarget(target, cert, conn.config);

  // Refuse an exact duplicate destination for the same certificate (auto or manual).
  for (const r of listDistributionRows(input.certificateId, db)) {
    if (r.connection_id !== conn.id) continue;
    let other: ResolvedTarget | null = null;
    try { other = resolveRowTarget(r); } catch { /* ignore unresolvable */ }
    if (sameTarget(other, resolved)) throw new Error('this certificate is already distributed to that destination');
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO certificate_distributions (id, certificate_id, connection_id, origin, target_json)
     VALUES (?, ?, ?, 'manual', ?)`,
  ).run(id, input.certificateId, conn.id, JSON.stringify(target));
  return rowToDistribution(getDistributionRow(id, db)!);
}

export function markPublished(
  id: string,
  fingerprint: string,
  target: ResolvedTarget,
  db: Db = getDb(),
): void {
  db.prepare(
    `UPDATE certificate_distributions
        SET published_fingerprint = ?, published_target_json = ?, published_at = unixepoch(),
            last_error = NULL, last_attempt_at = unixepoch(), attempts = 0, next_attempt_at = NULL
      WHERE id = ?`,
  ).run(fingerprint, JSON.stringify(target), id);
}

/** Record that the previously published location was cleaned up (move or removal). */
export function markUnpublished(id: string, db: Db = getDb()): void {
  db.prepare(
    `UPDATE certificate_distributions SET published_target_json = NULL, published_fingerprint = NULL WHERE id = ?`,
  ).run(id);
}

/** Exponential backoff: 5 min, 10, 20, … capped at 6 h. */
export function backoffSeconds(attempts: number): number {
  return Math.min(300 * 2 ** Math.max(0, attempts - 1), 21_600);
}

export function markFailed(id: string, error: string, db: Db = getDb()): { attempts: number; nextAttemptAt: number } {
  const row = db.prepare('SELECT attempts FROM certificate_distributions WHERE id = ?').get(id) as { attempts: number } | undefined;
  const attempts = (row?.attempts ?? 0) + 1;
  const nextAttemptAt = Math.floor(Date.now() / 1000) + backoffSeconds(attempts);
  db.prepare(
    `UPDATE certificate_distributions
        SET last_error = ?, last_attempt_at = unixepoch(), attempts = ?, next_attempt_at = ?
      WHERE id = ?`,
  ).run(error.slice(0, 2000), attempts, nextAttemptAt, id);
  return { attempts, nextAttemptAt };
}

export function deleteDistributionRow(id: string, db: Db = getDb()): void {
  db.prepare('DELETE FROM certificate_distributions WHERE id = ?').run(id);
}
