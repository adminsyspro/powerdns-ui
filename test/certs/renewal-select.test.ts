import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  createCertificate, updateCertificateIssuance, getCertificate,
  getCertificateBundle, markCertificateRenewalQueued, selectCertificatesDueForRenewal,
} from '../../src/lib/certs/cert-store';
import { enqueueJob, claimNextJob, getJob, reclaimStuckJobs } from '../../src/lib/certs/job-store';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE server_connections (id TEXT PRIMARY KEY, name TEXT, url TEXT, api_key TEXT, is_default INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE acme_accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE certificates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, acme_account_id TEXT NOT NULL,
      connection_id TEXT NOT NULL, server_url TEXT NOT NULL, sans_json TEXT NOT NULL DEFAULT '[]',
      key_type TEXT NOT NULL DEFAULT 'ecdsa', status TEXT NOT NULL DEFAULT 'pending',
      renewal_status TEXT NOT NULL DEFAULT 'idle', last_renewal_error TEXT DEFAULT NULL,
      error_class TEXT DEFAULT NULL, next_attempt_at INTEGER DEFAULT NULL,
      not_before INTEGER DEFAULT NULL, not_after INTEGER DEFAULT NULL,
      serial TEXT DEFAULT NULL, fingerprint_sha256 TEXT DEFAULT NULL, issuer TEXT DEFAULT NULL,
      cert_pem TEXT DEFAULT NULL, chain_pem TEXT DEFAULT NULL, privkey_enc TEXT DEFAULT NULL,
      key_download_enabled INTEGER NOT NULL DEFAULT 1, auto_renew INTEGER NOT NULL DEFAULT 1,
      renew_before_days INTEGER NOT NULL DEFAULT 30, last_issued_at INTEGER DEFAULT NULL,
      last_renewal_success_at INTEGER DEFAULT NULL, materialized_at INTEGER DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE certificate_jobs (
      id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL, kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued', owner TEXT DEFAULT NULL, attempt INTEGER NOT NULL DEFAULT 0,
      order_url TEXT DEFAULT NULL, challenges_json TEXT NOT NULL DEFAULT '[]', cleanup_done INTEGER NOT NULL DEFAULT 0,
      error_class TEXT DEFAULT NULL, error_message TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), claimed_at INTEGER DEFAULT NULL,
      finished_at INTEGER DEFAULT NULL, next_attempt_at INTEGER DEFAULT NULL
    );
    CREATE UNIQUE INDEX idx_certificate_jobs_active ON certificate_jobs(certificate_id) WHERE state IN ('queued','running');`);
  db.prepare(`INSERT INTO server_connections (id, name, url, api_key) VALUES ('c1','pdns','http://PDNS/','plain')`).run();
  db.prepare(`INSERT INTO acme_accounts (id, name) VALUES ('a1','x')`).run();
  return db;
}

const now = () => Math.floor(Date.now() / 1000);
const db = makeDb();

// --- helper: create an already-issued cert with a given not_after and settings ---
function issued(name: string, opts: { notAfterDeltaDays: number; autoRenew?: boolean; renewBeforeDays?: number; nextAttemptAt?: number | null }) {
  const c = createCertificate({ name, acmeAccountId: 'a1', connectionId: 'c1', sans: [`${name}.example.com`], autoRenew: opts.autoRenew, renewBeforeDays: opts.renewBeforeDays }, db);
  updateCertificateIssuance(c.id, {
    certPem: `-CERT-${name}-`, chainPem: `-CHAIN-${name}-`, privkeyPem: `-KEY-${name}-`,
    notBefore: now() - 86400, notAfter: now() + opts.notAfterDeltaDays * 86400,
    serial: 'AB', fingerprint: 'FF', issuer: 'CN=Test',
  }, db);
  if (opts.nextAttemptAt !== undefined) {
    db.prepare('UPDATE certificates SET next_attempt_at=? WHERE id=?').run(opts.nextAttemptAt, c.id);
  }
  return c.id;
}

// due: expires in 10 days, renew_before_days=30 → inside window
const due = issued('due', { notAfterDeltaDays: 10, renewBeforeDays: 30 });
// far: expires in 89 days, renew_before_days=30 → outside window
const far = issued('far', { notAfterDeltaDays: 89, renewBeforeDays: 30 });
// noauto: due window but auto_renew off
const noauto = issued('noauto', { notAfterDeltaDays: 5, renewBeforeDays: 30, autoRenew: false });
// backoff: due window but next_attempt_at in the future
const backoff = issued('backoff', { notAfterDeltaDays: 5, renewBeforeDays: 30, nextAttemptAt: now() + 3600 });
// pending: never issued (no cert_pem) — must be excluded
const pending = createCertificate({ name: 'pending', acmeAccountId: 'a1', connectionId: 'c1', sans: ['pending.example.com'] }, db).id;

// getCertificateBundle
assert.deepEqual(getCertificateBundle(due, db), { certPem: '-CERT-due-', chainPem: '-CHAIN-due-' }, 'bundle returns cert+chain');
assert.equal(getCertificateBundle(pending, db), null, 'no bundle for un-issued cert');
assert.equal(getCertificateBundle('nope', db), null, 'no bundle for missing cert');

// selection
const selected = selectCertificatesDueForRenewal(db).sort();
assert.deepEqual(selected, [due].sort(), 'only the due cert is selected');
assert.ok(!selected.includes(far), 'far-from-expiry excluded');
assert.ok(!selected.includes(noauto), 'auto_renew=0 excluded');
assert.ok(!selected.includes(backoff), 'future next_attempt_at excluded');
assert.ok(!selected.includes(pending), 'un-issued excluded');

// markCertificateRenewalQueued
markCertificateRenewalQueued(due, db);
assert.equal(getCertificate(due, db)!.renewalStatus, 'queued', 'renewal_status set to queued');

// a cert with an active job must be excluded from selection
enqueueJob(due, 'renew', db);
assert.ok(!selectCertificatesDueForRenewal(db).includes(due), 'cert with active job excluded');

// reclaimStuckJobs: a running job older than staleMs is requeued; a fresh one is not
const dueBundleCert = issued('stuck', { notAfterDeltaDays: 200 });
const j = enqueueJob(dueBundleCert, 'issue', db);
assert.ok('id' in j);
const claimed = claimNextJob('owner-dead', db)!;
assert.equal(claimed.state, 'running', 'job running');
// backdate claimed_at by 20 minutes
db.prepare('UPDATE certificate_jobs SET claimed_at = unixepoch() - 1200 WHERE id=?').run(claimed.id);
assert.equal(reclaimStuckJobs(900_000, db), 1, 'one stale job reclaimed (>15min)');
const reclaimed = getJob(claimed.id, db)!;
assert.equal(reclaimed.state, 'queued', 'stuck job requeued');
assert.equal(reclaimed.owner, null, 'owner cleared on reclaim');
// a freshly-claimed job is NOT reclaimed
claimNextJob('owner-live', db);
assert.equal(reclaimStuckJobs(900_000, db), 0, 'fresh running job not reclaimed');

console.log('certs/renewal-select: ALL PASSED');
