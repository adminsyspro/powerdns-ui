import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { getCertificateBundle, getCertificatePrivateKey, setCertificateMaterialized, setCertificateInfisicalSynced } from '../cert-store';
import { appendCertEvent } from '../event-store';
import { getProvider } from './registry';
import { getConnection, providerContext, deleteConnection } from './connection-store';
import {
  type DistributionRow, ensureAutoDistributions, getDistributionRow, listDistributionRows,
  listDistributionRowsForConnection, isOutOfDate, resolveRowTarget, sameTarget, markPublished, markUnpublished,
  markFailed, deleteDistributionRow,
} from './distribution-store';
import { FILESYSTEM_DEFAULT_ID } from './schema';
import type { CertMaterial, ResolvedTarget } from './types';

type Db = Database.Database;

export interface ReconcileOutcome {
  distributionId: string;
  connectionName: string;
  action: 'published' | 'up-to-date' | 'skipped' | 'failed';
  error?: string;
}

export interface ReconcileSummary {
  published: number;
  upToDate: number;
  skipped: number;
  failed: number;
  outcomes: ReconcileOutcome[];
}

function emptySummary(): ReconcileSummary {
  return { published: 0, upToDate: 0, skipped: 0, failed: 0, outcomes: [] };
}

function add(summary: ReconcileSummary, o: ReconcileOutcome): void {
  summary.outcomes.push(o);
  if (o.action === 'published') summary.published++;
  else if (o.action === 'up-to-date') summary.upToDate++;
  else if (o.action === 'skipped') summary.skipped++;
  else summary.failed++;
}

/** Short, secret-free description of a resolved target for events/logs. */
export function describeTarget(type: string, t: ResolvedTarget | null): string {
  if (!t) return '-';
  if (type === 'infisical-secrets') return `${t.projectId}/${t.environment}:${t.path}`;
  if (type === 'filesystem') return `${t.dir}/live/${t.name}`;
  return JSON.stringify(t);
}

function loadMaterial(certificateId: string, db: Db): CertMaterial | null {
  const cert = db.prepare('SELECT id, name, category, fingerprint_sha256, not_after FROM certificates WHERE id = ?')
    .get(certificateId) as { id: string; name: string; category: string | null; fingerprint_sha256: string | null; not_after: number | null } | undefined;
  if (!cert?.fingerprint_sha256) return null;
  const bundle = getCertificateBundle(certificateId, db);
  const privkey = getCertificatePrivateKey(certificateId, db);
  if (!bundle || !privkey) return null;
  return {
    certificateId,
    name: cert.name,
    category: cert.category,
    leafPem: bundle.certPem,
    chainPem: bundle.chainPem ?? '',
    privkeyPem: privkey,
    fingerprintSha256: cert.fingerprint_sha256,
    notAfter: cert.not_after,
  };
}

// In-process guard: the issuance path and the periodic cycle may target the
// same distribution concurrently; publishes are idempotent but there is no
// point running two at once.
const inFlight = new Set<string>();

async function reconcileRow(
  r: DistributionRow,
  opts: { force: boolean; material?: CertMaterial | null; log?: (msg: string) => void },
  db: Db,
): Promise<ReconcileOutcome> {
  const base = { distributionId: r.id, connectionName: r.conn_name };
  if (!r.conn_enabled) return { ...base, action: 'skipped', error: 'connection disabled' };
  if (!r.cert_has_pem || !r.cert_fingerprint) return { ...base, action: 'skipped', error: 'certificate not issued yet' };
  if (!opts.force && !isOutOfDate(r)) return { ...base, action: 'up-to-date' };
  if (inFlight.has(r.id)) return { ...base, action: 'skipped', error: 'already in progress' };

  inFlight.add(r.id);
  const provider = getProvider(r.conn_type);
  let wanted: ResolvedTarget | null = null;
  try {
    const conn = getConnection(r.connection_id, db);
    if (!conn) throw new Error('connection not found');
    const ctx = providerContext(conn, db);
    wanted = resolveRowTarget(r);
    const material = opts.material ?? loadMaterial(r.certificate_id, db);
    if (!material) throw new Error('certificate material unavailable');

    // Target moved (category change, connection default target edited, …):
    // remove the old copy first so no private key is left behind.
    const published = r.published_target_json ? (JSON.parse(r.published_target_json) as ResolvedTarget) : null;
    if (published && !sameTarget(published, wanted)) {
      await provider.unpublish(ctx, published, { name: r.cert_name });
      markUnpublished(r.id, db);
      appendCertEvent({
        certificateId: r.certificate_id, type: 'distribution_removed', status: 'ok',
        message: `${r.conn_name}: removed from previous location ${describeTarget(r.conn_type, published)}`,
      }, db);
      opts.log?.(`distribution ${r.conn_name}: removed old copy at ${describeTarget(r.conn_type, published)}`);
    }

    await provider.publish(ctx, wanted, material);
    markPublished(r.id, material.fingerprintSha256, wanted, db);
    if (r.conn_type === 'filesystem') setCertificateMaterialized(r.certificate_id, db);
    if (r.conn_type === 'infisical-secrets') setCertificateInfisicalSynced(r.certificate_id, db);
    appendCertEvent({
      certificateId: r.certificate_id, type: 'distribution_published', status: 'ok',
      message: `${r.conn_name}: published to ${describeTarget(r.conn_type, wanted)}`,
    }, db);
    opts.log?.(`distribution ${r.conn_name}: published to ${describeTarget(r.conn_type, wanted)}`);
    return { ...base, action: 'published' };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const prev = r.last_error;
    markFailed(r.id, msg, db);
    // One event per distinct error, not one per retry.
    if (prev !== msg.slice(0, 2000)) {
      appendCertEvent({
        certificateId: r.certificate_id, type: 'distribution_error', status: 'error',
        message: `${r.conn_name} (${describeTarget(r.conn_type, wanted)}): ${msg}`.slice(0, 2000),
      }, db);
    }
    opts.log?.(`⚠ distribution ${r.conn_name} failed: ${msg}`);
    return { ...base, action: 'failed', error: msg };
  } finally {
    inFlight.delete(r.id);
  }
}

/**
 * Bring every distribution of one certificate up to date. Called right after
 * issuance/renewal (then failures are retried by the periodic cycle) and by
 * the manual "Publish" actions (`force` republishes even when up to date).
 */
export async function reconcileCertificate(
  certificateId: string,
  opts: { force?: boolean; log?: (msg: string) => void } = {},
  db: Db = getDb(),
): Promise<ReconcileSummary> {
  ensureAutoDistributions(db);
  const summary = emptySummary();
  const material = loadMaterial(certificateId, db);
  for (const r of listDistributionRows(certificateId, db)) {
    add(summary, await reconcileRow(r, { force: !!opts.force, material, log: opts.log }, db)); // NOSONAR — sequential on purpose (remote APIs, run-log order)
  }
  return summary;
}

/** Publish one distribution now (manual action). */
export async function reconcileDistribution(id: string, opts: { force?: boolean } = {}, db: Db = getDb()): Promise<ReconcileOutcome> {
  const r = getDistributionRow(id, db);
  if (!r) throw new Error('distribution not found');
  return reconcileRow(r, { force: !!opts.force }, db);
}

/**
 * Periodic pass: attach auto distributions, then publish every out-of-date
 * distribution whose backoff has elapsed. Sequential on purpose (few rows,
 * gentle on remote APIs).
 */
export async function runDistributionCycle(db: Db = getDb(), now = Math.floor(Date.now() / 1000)): Promise<ReconcileSummary> {
  ensureAutoDistributions(db);
  const summary = emptySummary();
  for (const r of listDistributionRows(undefined, db)) {
    if (!r.conn_enabled || !r.cert_has_pem) continue;
    if (r.next_attempt_at != null && r.next_attempt_at > now) continue;
    let due = false;
    try { due = isOutOfDate(r); } catch { due = true; } // unresolvable target → surface the error
    if (!due) continue;
    add(summary, await reconcileRow(r, { force: false }, db)); // NOSONAR — sequential on purpose (gentle on remote APIs)
  }
  return summary;
}

async function unpublishRow(r: DistributionRow, db: Db): Promise<void> {
  if (!r.published_target_json) return;
  const conn = getConnection(r.connection_id, db);
  if (!conn) return;
  const target = JSON.parse(r.published_target_json) as ResolvedTarget;
  await getProvider(r.conn_type).unpublish(providerContext(conn, db), target, { name: r.cert_name });
  markUnpublished(r.id, db);
  appendCertEvent({
    certificateId: r.certificate_id, type: 'distribution_removed', status: 'ok',
    message: `${r.conn_name}: removed from ${describeTarget(r.conn_type, target)}`,
  }, db);
}

/** Remove one manual distribution: delete what it published, then the row. */
export async function removeDistribution(id: string, db: Db = getDb()): Promise<void> {
  const r = getDistributionRow(id, db);
  if (!r) throw new Error('distribution not found');
  if (r.origin === 'auto') {
    throw new Error(`"${r.conn_name}" applies to every certificate; disable automatic attachment on the connection instead`);
  }
  await unpublishRow(r, db);
  deleteDistributionRow(id, db);
}

/**
 * Before deleting a certificate: unpublish everywhere (best-effort per row) and
 * drop its distribution rows. Returns the errors so the caller can report them.
 */
export async function removeAllForCertificate(certificateId: string, db: Db = getDb()): Promise<string[]> {
  const errors: string[] = [];
  for (const r of listDistributionRows(certificateId, db)) {
    try {
      await unpublishRow(r, db); // NOSONAR — sequential, per-row error collection
    } catch (e) {
      errors.push(`${r.conn_name}: ${(e as Error).message}`);
    }
  }
  db.prepare('DELETE FROM certificate_distributions WHERE certificate_id = ?').run(certificateId);
  return errors;
}

/** Delete a connection after unpublishing everything it distributed. Stops at the first unpublish error. */
export async function removeConnection(connectionId: string, db: Db = getDb()): Promise<void> {
  if (connectionId === FILESYSTEM_DEFAULT_ID) {
    throw new Error('the local disk connection cannot be deleted (disable it instead)');
  }
  if (!getConnection(connectionId, db)) throw new Error('connection not found');
  for (const r of listDistributionRowsForConnection(connectionId, db)) {
    await unpublishRow(r, db); // NOSONAR — sequential: stop at the first unpublish failure
    deleteDistributionRow(r.id, db);
  }
  deleteConnection(connectionId, db);
}
