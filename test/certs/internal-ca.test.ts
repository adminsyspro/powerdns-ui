import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getAcmeAccountByName } from '../../src/lib/certs/store';
import { readCertMeta, reconcileBundledAccount, BUNDLED_ACCOUNT_NAME } from '../../src/lib/certs/internal-ca';
import { fingerprintSha256 } from '../../src/lib/certs/acme-trust';
import { ROOT_A_PEM, ROOT_B_PEM } from './fixtures/trust-certs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE acme_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    ca_type TEXT NOT NULL DEFAULT 'letsencrypt', directory_url TEXT NOT NULL,
    contact_email TEXT NOT NULL DEFAULT '', eab_kid TEXT DEFAULT NULL, eab_hmac_key TEXT DEFAULT NULL,
    account_key_pem TEXT DEFAULT NULL, account_url TEXT DEFAULT NULL,
    tos_agreed INTEGER NOT NULL DEFAULT 0, tos_agreed_at INTEGER DEFAULT NULL,
    root_pem TEXT DEFAULT NULL, root_fingerprint_sha256 TEXT DEFAULT NULL,
    propagation_mode TEXT NOT NULL DEFAULT 'authoritative', propagation_resolver TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'unregistered', last_error TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`);
  return db;
}

// readCertMeta parses a real cert file
const rootPath = join(tmpdir(), `phase5-root-${process.pid}.pem`);
writeFileSync(rootPath, ROOT_A_PEM);
const meta = readCertMeta(rootPath)!;
assert.equal(meta.fingerprint, fingerprintSha256(ROOT_A_PEM), 'readCertMeta fingerprint matches');
assert.ok(meta.notAfter > Math.floor(Date.now() / 1000), 'notAfter parsed');
assert.equal(readCertMeta(null), null, 'null path => null');
assert.equal(readCertMeta('/no/such/file.pem'), null, 'missing file => null (no throw)');

// reconcileBundledAccount is idempotent: two calls => one row, updated in place
const db = makeDb();
const args1 = { directoryUrl: 'https://step-ca:9000/acme/acme/directory', rootPem: ROOT_A_PEM, rootFingerprintSha256: fingerprintSha256(ROOT_A_PEM), propagationResolver: '10.0.0.53' };
const a1 = reconcileBundledAccount(args1, db);
assert.equal(a1.name, BUNDLED_ACCOUNT_NAME, 'reserved name');
assert.equal(a1.caType, 'step-ca', 'ca type step-ca');
assert.equal(a1.propagationMode, 'resolver', 'resolver mode');
assert.equal(a1.propagationResolver, '10.0.0.53', 'resolver stored');
assert.equal(a1.tosAgreed, true, 'tos auto-agreed for internal CA');

// second call with a rotated root updates the SAME row (no UNIQUE collision, no duplicate)
const args2 = { ...args1, rootPem: ROOT_B_PEM, rootFingerprintSha256: fingerprintSha256(ROOT_B_PEM), propagationResolver: '10.0.0.54' };
const a2 = reconcileBundledAccount(args2, db);
assert.equal(a2.id, a1.id, 'same account id (upsert-in-place)');
assert.equal(a2.rootFingerprintSha256, fingerprintSha256(ROOT_B_PEM), 'root fingerprint rotated');
assert.equal(a2.propagationResolver, '10.0.0.54', 'resolver updated');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM acme_accounts').get().n, 1, 'exactly one bundled account row');
assert.ok(getAcmeAccountByName(BUNDLED_ACCOUNT_NAME, db), 'lookup by name works');

console.log('certs/internal-ca: ALL PASSED');
