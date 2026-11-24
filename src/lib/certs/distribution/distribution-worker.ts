import { randomUUID } from 'node:crypto';
import { acquireLease } from '../cert-lease';
import { runDistributionCycle } from './reconcile';

// 5 min default, floor 30 s. Retries use per-distribution backoff (5 min → 6 h).
const INTERVAL_MS = Math.max(30_000, Number(process.env.CERT_DISTRIBUTION_INTERVAL_MS) || 300_000);
const OWNER = `${process.pid}-${randomUUID()}`;
const LEASE_TTL_MS = INTERVAL_MS * 3;
const LEASE_ID = 'cert-distribution';

let started = false;

/**
 * Periodic reconciler for certificate distributions: republishes anything out
 * of date (renewal whose publish failed, target moved, connection re-enabled…).
 * Issuance publishes immediately on its own; this loop is the safety net.
 */
export function startDistributionWorker(): void {
  const g = globalThis as unknown as { __certDistributionStarted?: boolean };
  if (started || g.__certDistributionStarted) return;
  started = true;
  g.__certDistributionStarted = true;

  console.log(`[cert-distribution] worker enabled — interval ${INTERVAL_MS}ms, owner ${OWNER}`);

  const tick = async () => {
    try {
      if (acquireLease(OWNER, LEASE_TTL_MS, LEASE_ID)) {
        const s = await runDistributionCycle();
        if (s.published || s.failed) {
          console.log(`[cert-distribution] cycle: published ${s.published}, failed ${s.failed}`);
        }
      }
    } catch (e) {
      console.warn(`[cert-distribution] cycle error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  };
  setTimeout(tick, INTERVAL_MS);
}
