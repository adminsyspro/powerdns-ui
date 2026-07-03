import { getDb } from '@/lib/cache/db';

/**
 * Best-effort lease: claims (or renews) the named worker lease for `owner`.
 * Succeeds if we already hold it or the current holder's heartbeat is stale.
 * Returns true when this process owns the lease afterwards. `leaseId` lets
 * independent workers (issuance vs. renewal) hold separate leases.
 */
export function acquireLease(owner: string, ttlMs: number, leaseId: string = 'cert-engine'): boolean {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO worker_lease (id, owner, heartbeat) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, heartbeat = excluded.heartbeat
         WHERE worker_lease.owner = excluded.owner OR worker_lease.heartbeat < ?`
  ).run(leaseId, owner, now, now - ttlMs);
  const row = db.prepare('SELECT owner FROM worker_lease WHERE id = ?').get(leaseId) as
    | { owner: string }
    | undefined;
  return row?.owner === owner;
}
