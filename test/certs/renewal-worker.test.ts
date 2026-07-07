import assert from 'node:assert';
import Database from 'better-sqlite3';
import { createCertificate, updateCertificateIssuance, getCertificate } from '../../src/lib/certs/cert-store';
import { claimNextJob, getJob, listActiveJobs } from '../../src/lib/certs/job-store';
import { runRenewalCycle } from '../../src/lib/certs/renewal-worker';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE server_connections (id TEXT PRIMARY KEY, name TEXT, url TEXT, api_key TEXT, is_default INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE acme_accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE certificates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, acme_account_id TEXT NOT NULL,
      connection_id TEXT NOT NULL, server_url TEXT NOT NULL, sans_json TEXT NOT NULL DEFAULT '[]',
      category TEXT DEFAULT NULL, comment TEXT DEFAULT NULL, last_run_log TEXT DEFAULT NULL,
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
const c = createCertificate({ name: 'web', acmeAccountId: 'a1', connectionId: 'c1', sans: ['web.example.com'] }, db);
updateCertificateIssuance(c.id, {
  certPem: '-C-', chainPem: '-CH-', privkeyPem: '-K-',
  notBefore: now() - 86400, notAfter: now() + 5 * 86400, serial: 'AB', fingerprint: 'FF', issuer: 'CN=Test',
}, db);

const r1 = runRenewalCycle(db);
assert.equal(r1.enqueued, 1, 'one renew job enqueued for the due cert');
assert.equal(r1.reclaimed, 0, 'nothing to reclaim');
assert.equal(getCertificate(c.id, db)!.renewalStatus, 'queued', 'cert marked queued');
const active = listActiveJobs(c.id, db);
assert.equal(active.length, 1, 'exactly one active job');
assert.equal(active[0].kind, 'renew', 'job kind is renew');

// second cycle: job still active → not re-enqueued
const r2 = runRenewalCycle(db);
assert.equal(r2.enqueued, 0, 'no duplicate enqueue while a job is active');

// simulate a crashed worker: claim + backdate → next cycle reclaims it
const claimed = claimNextJob('dead', db)!;
db.prepare('UPDATE certificate_jobs SET claimed_at = unixepoch() - 1200 WHERE id=?').run(claimed.id);
const r3 = runRenewalCycle(db);
assert.equal(r3.reclaimed, 1, 'stale running job reclaimed');
assert.equal(getJob(claimed.id, db)!.state, 'queued', 'reclaimed job is queued again');

console.log('certs/renewal-worker: ALL PASSED');
