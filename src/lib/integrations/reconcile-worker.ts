import { randomUUID } from 'crypto';
import { listIntegrations } from './store';
import { getConnectionById } from './connections';
import { runSync } from './sync';
import { acquireLease } from './worker-lease';
import { refreshZonesCache } from '@/lib/cache/refresh-zones';
import type { IntegrationRow } from './types';

const INTERVAL_MS = Math.max(30_000, Number(process.env.INTEGRATION_RECONCILE_INTERVAL_MS) || 300_000);
const OWNER = `${process.pid}-${randomUUID()}`;
const LEASE_TTL_MS = INTERVAL_MS * 3;

async function runCycle(): Promise<void> {
  if (!acquireLease(OWNER, LEASE_TTL_MS)) return; // another process owns the loop

  // Active integrations grouped by their bound connection.
  const byConnection = new Map<string, IntegrationRow[]>();
  for (const integration of listIntegrations()) {
    if (!integration.active || !integration.connectionId) continue;
    const list = byConnection.get(integration.connectionId) ?? [];
    list.push(integration);
    byConnection.set(integration.connectionId, list);
  }

  for (const [connectionId, integrations] of byConnection) {
    const conn = getConnectionById(connectionId);
    if (!conn) continue; // connection deleted — skip until re-bound
    if (!(await refreshZonesCache(conn.url, conn.apiKey))) continue;
    for (const integration of integrations) {
      // runSync is a no-op when a manual sync is already running for this pair.
      await runSync(integration.id, conn.url, { allowDeletion: true });
    }
  }
}

let started = false;

export function startReconcileWorker(): void {
  // Guard against double-start (HMR / repeated register calls in one process).
  const g = globalThis as unknown as { __cfReconcileStarted?: boolean };
  if (started || g.__cfReconcileStarted) return;
  started = true;
  g.__cfReconcileStarted = true;

  console.log(`[reconcile] background worker enabled — interval ${INTERVAL_MS}ms, owner ${OWNER}`);

  const tick = async () => {
    try {
      await runCycle();
    } catch (e) {
      console.warn(`[reconcile] cycle error: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTimeout(tick, INTERVAL_MS);
    }
  };
  // First cycle after one interval (let the server settle before hammering PDNS/CF).
  setTimeout(tick, INTERVAL_MS);
}
