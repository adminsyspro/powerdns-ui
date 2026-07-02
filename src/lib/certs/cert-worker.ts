import { randomUUID } from 'crypto';
import { acquireLease } from './cert-lease';
import { claimNextJob } from './job-store';
import { runJob } from './acme-engine';

const INTERVAL_MS = Math.max(30_000, Number(process.env.CERT_WORKER_INTERVAL_MS) || 60_000);
const OWNER = `${process.pid}-${randomUUID()}`;
const LEASE_TTL_MS = INTERVAL_MS * 3;

async function runCycle(): Promise<void> {
  if (!acquireLease(OWNER, LEASE_TTL_MS)) return; // another process owns the loop
  // A single job can run longer than one cycle interval (DNS propagation
  // waits, slow CAs, etc.) — heartbeat the lease at half the interval while
  // draining so a long-running job doesn't let the lease expire and get
  // stolen by another process mid-job.
  const hb = setInterval(() => acquireLease(OWNER, LEASE_TTL_MS), Math.floor(INTERVAL_MS / 2));
  try {
    // Drain due queued jobs (bounded per cycle to avoid starving the loop).
    for (let i = 0; i < 20; i++) {
      const job = claimNextJob(OWNER);
      if (!job) break;
      await runJob(job.id);
    }
  } finally {
    clearInterval(hb);
  }
}

let started = false;

export function startCertWorker(): void {
  // Guard against double-start (HMR / repeated register calls in one process).
  const g = globalThis as unknown as { __certWorkerStarted?: boolean };
  if (started || g.__certWorkerStarted) return;
  started = true;
  g.__certWorkerStarted = true;

  console.log(`[cert-worker] background worker enabled — interval ${INTERVAL_MS}ms, owner ${OWNER}`);

  const tick = async () => {
    try {
      await runCycle();
    } catch (e) {
      console.warn(`[cert-worker] cycle error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  };
  // First cycle after one interval (let the server settle before hammering PDNS/CA).
  setTimeout(tick, INTERVAL_MS);
}
