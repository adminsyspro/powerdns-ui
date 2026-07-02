import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  enqueueJob, claimNextJob, recordJobOrder, recordJobChallenges,
  markJobCleanupDone, finishJob, getJob,
} from '../../src/lib/certs/job-store';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE certificate_jobs (
    id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL, kind TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued', owner TEXT DEFAULT NULL, attempt INTEGER NOT NULL DEFAULT 0,
    order_url TEXT DEFAULT NULL, challenges_json TEXT NOT NULL DEFAULT '[]', cleanup_done INTEGER NOT NULL DEFAULT 0,
    error_class TEXT DEFAULT NULL, error_message TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), claimed_at INTEGER DEFAULT NULL,
    finished_at INTEGER DEFAULT NULL, next_attempt_at INTEGER DEFAULT NULL
  );
  CREATE UNIQUE INDEX idx_certificate_jobs_active ON certificate_jobs(certificate_id) WHERE state IN ('queued','running');`);
  return db;
}

const db = makeDb();
const q1 = enqueueJob('cert1', 'issue', db);
assert.ok('id' in q1 && q1.id, 'first enqueue creates a job');
// second enqueue while one is active → refused
const q2 = enqueueJob('cert1', 'issue', db);
assert.deepEqual(q2, { alreadyActive: true }, 'no duplicate active job for same cert');

// claim it once
const claimed = claimNextJob('owner-A', db)!;
assert.equal(claimed.certificateId, 'cert1', 'claimed the queued job');
assert.equal(claimed.state, 'running', 'now running');
assert.equal(claimed.owner, 'owner-A', 'owner set');
assert.equal(claimed.attempt, 1, 'attempt incremented');
// no more queued jobs to claim
assert.equal(claimNextJob('owner-B', db), undefined, 'nothing left to claim');

recordJobOrder(claimed.id, 'https://acme/order/1', db);
recordJobChallenges(claimed.id, [{ fqdn: '_acme-challenge.example.com.', value: 'v1' }], db);
markJobCleanupDone(claimed.id, db);
const mid = getJob(claimed.id, db)!;
assert.equal(mid.orderUrl, 'https://acme/order/1', 'order url persisted (crash-resume)');
assert.equal(mid.cleanupDone, true, 'cleanup flag');
assert.equal(mid.challenges.length, 1, 'challenges persisted');

finishJob(claimed.id, 'failed', { errorClass: 'propagation', message: 'timeout', nextAttemptAt: 5000 }, db);
const done = getJob(claimed.id, db)!;
assert.equal(done.state, 'failed', 'finished failed');
assert.ok(done.finishedAt && done.finishedAt > 0, 'finishedAt set');

// after finishing, a new job can be enqueued again
const q3 = enqueueJob('cert1', 'renew', db);
assert.ok('id' in q3, 're-enqueue allowed once prior job finished');

console.log('certs/job-store: ALL PASSED');
