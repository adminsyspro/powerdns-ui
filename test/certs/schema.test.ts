import assert from 'node:assert';
import Database from 'better-sqlite3';

// Mirror the cert schema block that Task 2 Step 3 adds to initSchema().
const CERT_SCHEMA = `
CREATE TABLE IF NOT EXISTS acme_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  ca_type TEXT NOT NULL DEFAULT 'letsencrypt', directory_url TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT '', eab_kid TEXT DEFAULT NULL, eab_hmac_key TEXT DEFAULT NULL,
  account_key_pem TEXT DEFAULT NULL, account_url TEXT DEFAULT NULL,
  tos_agreed INTEGER NOT NULL DEFAULT 0, tos_agreed_at INTEGER DEFAULT NULL,
  root_pem TEXT DEFAULT NULL, root_fingerprint_sha256 TEXT DEFAULT NULL,
  propagation_mode TEXT NOT NULL DEFAULT 'authoritative', propagation_resolver TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'unregistered', last_error TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS certificates (
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
CREATE INDEX IF NOT EXISTS idx_certificates_renewal ON certificates(auto_renew, not_after);
CREATE INDEX IF NOT EXISTS idx_certificates_next_attempt ON certificates(next_attempt_at);
CREATE TABLE IF NOT EXISTS certificate_jobs (
  id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL, kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', owner TEXT DEFAULT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  order_url TEXT DEFAULT NULL, challenges_json TEXT NOT NULL DEFAULT '[]', cleanup_done INTEGER NOT NULL DEFAULT 0,
  error_class TEXT DEFAULT NULL, error_message TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), claimed_at INTEGER DEFAULT NULL,
  finished_at INTEGER DEFAULT NULL, next_attempt_at INTEGER DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificate_jobs_state ON certificate_jobs(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_certificate_jobs_cert ON certificate_jobs(certificate_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificate_jobs_active ON certificate_jobs(certificate_id) WHERE state IN ('queued','running');
CREATE TABLE IF NOT EXISTS certificate_events (
  id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()),
  type TEXT NOT NULL, status TEXT DEFAULT NULL, actor TEXT DEFAULT NULL,
  actor_ip TEXT DEFAULT NULL, message TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_certificate_events_cert ON certificate_events(certificate_id, ts);
`;

const db = new Database(':memory:');
// legacy DB: some pre-existing table + row
db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);`);
db.prepare(`INSERT INTO app_settings (key, value) VALUES ('x','1')`).run();

// apply cert schema (idempotent, run twice to prove IF NOT EXISTS)
db.exec(CERT_SCHEMA);
db.exec(CERT_SCHEMA);

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r: any) => r.name);
for (const t of ['acme_accounts', 'certificates', 'certificate_jobs', 'certificate_events']) {
  assert.ok(tables.includes(t), `table ${t} exists`);
}
const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map((r: any) => r.name);
for (const i of ['idx_certificates_renewal', 'idx_certificate_jobs_state', 'idx_certificate_jobs_active', 'idx_certificate_events_cert']) {
  assert.ok(idx.includes(i), `index ${i} exists`);
}
assert.equal((db.prepare(`SELECT value FROM app_settings WHERE key='x'`).get() as any).value, '1', 'legacy data intact');

// defaults fire on insert
db.prepare(`INSERT INTO acme_accounts (id, name, directory_url) VALUES ('a','le','https://d/')`).run();
const acc = db.prepare(`SELECT ca_type, status, tos_agreed, created_at FROM acme_accounts WHERE id='a'`).get() as any;
assert.equal(acc.ca_type, 'letsencrypt', 'ca_type default');
assert.equal(acc.status, 'unregistered', 'status default');
assert.equal(acc.tos_agreed, 0, 'tos default');
assert.ok(acc.created_at > 0, 'created_at default fired');

console.log('certs/schema: ALL PASSED');
