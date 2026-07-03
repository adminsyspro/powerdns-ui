import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import type { CertJob } from './types';

type Db = Database.Database;

function rowToJob(r: any): CertJob {
  return {
    id: r.id,
    certificateId: r.certificate_id,
    kind: r.kind,
    state: r.state,
    owner: r.owner ?? null,
    attempt: r.attempt,
    orderUrl: r.order_url ?? null,
    challenges: JSON.parse(r.challenges_json),
    cleanupDone: r.cleanup_done === 1,
    errorClass: r.error_class ?? null,
    errorMessage: r.error_message ?? null,
    createdAt: r.created_at,
    claimedAt: r.claimed_at ?? null,
    finishedAt: r.finished_at ?? null,
    nextAttemptAt: r.next_attempt_at ?? null,
  };
}

/**
 * Enqueue an issuance/renewal job. A second active job for the same
 * certificate (one active job per cert) is refused by the DB — a partial
 * unique index on certificate_jobs(certificate_id) WHERE state IN
 * ('queued','running') (see initSchema) rejects the INSERT — so this is race
 * free even under concurrent callers, unlike a SELECT-then-INSERT check.
 */
export function enqueueJob(
  certificateId: string,
  kind: 'issue' | 'renew',
  db: Db = getDb()
): { id: string } | { alreadyActive: true } {
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO certificate_jobs (id, certificate_id, kind) VALUES (?,?,?)').run(
      id,
      certificateId,
      kind
    );
    return { id };
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err?.message).includes('UNIQUE')) {
      return { alreadyActive: true as const };
    }
    throw err;
  }
}

/**
 * Atomically claim the oldest due queued job via a compare-and-swap UPDATE, so
 * concurrent workers never claim the same job. Returns undefined if none due or
 * the CAS lost the race.
 */
export function claimNextJob(owner: string, db: Db = getDb()): CertJob | undefined {
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id FROM certificate_jobs
         WHERE state='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= unixepoch())
         ORDER BY created_at LIMIT 1`
      )
      .get() as { id: string } | undefined;
    if (!row) return undefined;
    const result = db
      .prepare(
        `UPDATE certificate_jobs
         SET state='running', owner=?, claimed_at=unixepoch(), attempt=attempt+1
         WHERE id=? AND state='queued'`
      )
      .run(owner, row.id);
    if (result.changes === 1) return getJob(row.id, db);
    return undefined;
  })();
}

export function recordJobOrder(jobId: string, orderUrl: string, db: Db = getDb()): void {
  db.prepare('UPDATE certificate_jobs SET order_url=? WHERE id=?').run(orderUrl, jobId);
}

export function recordJobChallenges(
  jobId: string,
  challenges: { fqdn: string; value: string }[],
  db: Db = getDb()
): void {
  db.prepare('UPDATE certificate_jobs SET challenges_json=? WHERE id=?').run(
    JSON.stringify(challenges),
    jobId
  );
}

export function markJobCleanupDone(jobId: string, db: Db = getDb()): void {
  db.prepare('UPDATE certificate_jobs SET cleanup_done=1 WHERE id=?').run(jobId);
}

export function finishJob(
  jobId: string,
  state: 'succeeded' | 'failed',
  opts: { errorClass?: string; message?: string; nextAttemptAt?: number } = {},
  db: Db = getDb()
): void {
  db.prepare(
    `UPDATE certificate_jobs
     SET state=?, error_class=?, error_message=?, next_attempt_at=?, finished_at=unixepoch()
     WHERE id=?`
  ).run(state, opts.errorClass ?? null, opts.message ?? null, opts.nextAttemptAt ?? null, jobId);
}

export function getJob(jobId: string, db: Db = getDb()): CertJob | undefined {
  const r = db.prepare('SELECT * FROM certificate_jobs WHERE id=?').get(jobId);
  return r ? rowToJob(r) : undefined;
}

export function listActiveJobs(certificateId: string, db: Db = getDb()): CertJob[] {
  return db
    .prepare(
      "SELECT * FROM certificate_jobs WHERE certificate_id=? AND state IN ('queued','running') ORDER BY created_at"
    )
    .all(certificateId)
    .map(rowToJob);
}

/**
 * Reconcile orphaned jobs: a job stuck in state='running' whose worker died
 * (lease expired, no heartbeat) leaves the row 'running' forever, so it is
 * never re-claimed and the cert can silently expire. Requeue any 'running' job
 * whose claimed_at is older than staleMs. runJob is resume-safe (re-checks the
 * ACME order, re-uses the persisted key), so re-running a reclaimed job is safe.
 * This safety also relies on the single-drainer invariant: only one process
 * holds the 'cert-engine' lease and drains jobs sequentially, so a reclaimed
 * job never runs concurrently with a still-running original. A future change
 * introducing parallel drainers would break this and must not requeue running
 * jobs by wall-clock alone.
 * next_attempt_at is left untouched so claimNextJob picks it up on the next
 * cycle. Returns the number of jobs reclaimed.
 */
export function reclaimStuckJobs(staleMs: number, db: Db = getDb()): number {
  const staleSeconds = Math.floor(staleMs / 1000);
  return db
    .prepare(
      `UPDATE certificate_jobs
       SET state='queued', owner=NULL
       WHERE state='running' AND claimed_at IS NOT NULL AND claimed_at <= unixepoch() - ?`
    )
    .run(staleSeconds).changes;
}
