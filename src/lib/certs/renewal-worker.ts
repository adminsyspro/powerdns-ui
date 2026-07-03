import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { acquireLease } from './cert-lease';
import { reclaimStuckJobs, enqueueJob } from './job-store';
import { selectCertificatesDueForRenewal, markCertificateRenewalQueued } from './cert-store';

type Db = Database.Database;

// 6h default, floor 30s (mirrors reconcile-worker flooring).
const INTERVAL_MS = Math.max(30_000, Number(process.env.CERT_RENEWAL_INTERVAL_MS) || 21_600_000);
// A running job older than this is considered orphaned (worker crashed). Floor
// 10min — must exceed the longest legitimate issuance (DNS propagation + finalize).
// Invariant: CERT_JOB_STALE_MS MUST remain greater than the longest legitimate
// job duration, which is driven by CERT_DNS_PROPAGATION_TIMEOUT_MS (see
// acme-engine.ts). If an operator raises the propagation timeout above this
// stale threshold, reclaimStuckJobs could requeue a job that is still
// legitimately running.
const STALE_JOB_MS = Math.max(600_000, Number(process.env.CERT_JOB_STALE_MS) || 900_000);
const OWNER = `${process.pid}-${randomUUID()}`;
const LEASE_TTL_MS = INTERVAL_MS * 3;
const LEASE_ID = 'cert-renewal';

/**
 * One renewal pass (pure w.r.t. timers/lease so it can be unit-tested):
 *  (1) reclaim orphaned running jobs (crash recovery),
 *  (2) enqueue a `renew` job for each due certificate and mark it queued.
 * The existing cert-worker (lease 'cert-engine') then executes the jobs.
 */
export function runRenewalCycle(db: Db = getDb()): { reclaimed: number; enqueued: number } {
  const reclaimed = reclaimStuckJobs(STALE_JOB_MS, db);
  let enqueued = 0;
  for (const id of selectCertificatesDueForRenewal(db)) {
    const r = enqueueJob(id, 'renew', db);
    if ('id' in r) {
      markCertificateRenewalQueued(id, db);
      enqueued++;
    }
  }
  return { reclaimed, enqueued };
}

let started = false;

export function startRenewalWorker(): void {
  const g = globalThis as unknown as { __certRenewalStarted?: boolean };
  if (started || g.__certRenewalStarted) return;
  started = true;
  g.__certRenewalStarted = true;

  console.log(`[cert-renewal] renewal worker enabled — interval ${INTERVAL_MS}ms, owner ${OWNER}`);

  const tick = async () => {
    try {
      if (acquireLease(OWNER, LEASE_TTL_MS, LEASE_ID)) {
        const { reclaimed, enqueued } = runRenewalCycle();
        if (reclaimed || enqueued) {
          console.log(`[cert-renewal] cycle: reclaimed ${reclaimed}, enqueued ${enqueued}`);
        }
      }
    } catch (e) {
      console.warn(`[cert-renewal] cycle error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  };
  setTimeout(tick, INTERVAL_MS);
}
