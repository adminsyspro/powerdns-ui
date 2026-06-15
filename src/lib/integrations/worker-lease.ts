import { getDb } from '@/lib/cache/db';

const LEASE_ID = 'reconcile';

/**
 * Best-effort lease: claims (or renews) the reconcile lease for `owner`.
 * Succeeds if we already hold it or the current holder's heartbeat is stale.
 * Returns true when this process owns the lease afterwards.
 */
export function acquireLease(owner: string, ttlMs: number): boolean {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO worker_lease (id, owner, heartbeat) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, heartbeat = excluded.heartbeat
         WHERE worker_lease.owner = excluded.owner OR worker_lease.heartbeat < ?`
  ).run(LEASE_ID, owner, now, now - ttlMs);
  const row = db.prepare('SELECT owner FROM worker_lease WHERE id = ?').get(LEASE_ID) as
    | { owner: string }
    | undefined;
  return row?.owner === owner;
}
