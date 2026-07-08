import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  createCertificate, getCertificate, listCertificates, getCertificatePrivateKey,
  updateCertificateIssuance, setCertificateRenewalFailure, deleteCertificate, certificatesUsingAccount,
  setCertificatePrivateKey, setCertificateMaterialized,
} from '../../src/lib/certs/cert-store';

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
    );`);
  db.prepare(`INSERT INTO server_connections (id, name, url, api_key) VALUES ('c1','pdns','http://PDNS/','plain')`).run();
  db.prepare(`INSERT INTO acme_accounts (id, name) VALUES ('a1','x')`).run();
  return db;
}

const db = makeDb();
const cert = createCertificate({ name: 'web', acmeAccountId: 'a1', connectionId: 'c1', sans: ['Example.com', '*.example.com', 'example.com'] }, db);
assert.equal(cert.status, 'pending', 'starts pending');
assert.deepEqual(cert.sans, ['example.com', '*.example.com'], 'SANs canonicalized + deduped');
assert.equal(cert.serverUrl, 'http://pdns', 'server_url derived + normalized from connection');
assert.equal((cert as any).privkeyEnc, undefined, 'no privkey on public shape');

// duplicate-domains guard: an exact SAN set (order / case / trailing-dot
// independent) is rejected even under a different name.
assert.throws(
  () => createCertificate({ name: 'web-dup', acmeAccountId: 'a1', connectionId: 'c1', sans: ['*.EXAMPLE.com', 'example.com.'] }, db),
  /same domains/i,
  'exact-duplicate SAN set rejected regardless of order/case/trailing-dot',
);
// a DIFFERENT SAN set is allowed; delete it so later account-usage counts hold.
const distinct = createCertificate({ name: 'web-distinct', acmeAccountId: 'a1', connectionId: 'c1', sans: ['api.example.com'] }, db);
assert.deepEqual(distinct.sans, ['api.example.com'], 'distinct SAN set is created');
assert.equal(deleteCertificate(distinct.id, db), true, 'cleanup extra cert');

updateCertificateIssuance(cert.id, {
  certPem: '-CERT-', chainPem: '-CHAIN-', privkeyPem: '-KEY-',
  notBefore: 1000, notAfter: 2000, serial: 'AB', fingerprint: 'FF', issuer: 'CN=Test',
}, db);
const issued = getCertificate(cert.id, db)!;
assert.equal(issued.status, 'valid', 'valid after issuance');
assert.equal(issued.hasCert, true, 'hasCert flag');
assert.equal(issued.notAfter, 2000, 'notAfter stored');
assert.equal(getCertificatePrivateKey(cert.id, db), '-KEY-', 'privkey decrypts via strict');
const rawKey = (db.prepare('SELECT privkey_enc FROM certificates WHERE id=?').get(cert.id) as any).privkey_enc;
assert.notEqual(rawKey, '-KEY-', 'privkey encrypted at rest');

// renewal failure must NOT clobber a still-valid cert
setCertificateRenewalFailure(cert.id, { errorClass: 'propagation', message: 'timeout', nextAttemptAt: 9999 }, db);
const afterFail = getCertificate(cert.id, db)!;
assert.equal(afterFail.status, 'valid', 'still valid after renewal failure');
assert.equal(afterFail.renewalStatus, 'failed', 'renewal_status failed');
assert.equal(afterFail.nextAttemptAt, 9999, 'backoff stored');

// setCertificatePrivateKey / getCertificatePrivateKey round-trip (used by the
// engine to persist the key BEFORE finalizeOrder, ahead of a full issuance).
setCertificatePrivateKey(cert.id, '-PRE-FINALIZE-KEY-', db);
assert.equal(
  getCertificatePrivateKey(cert.id, db),
  '-PRE-FINALIZE-KEY-',
  'setCertificatePrivateKey round-trips via getCertificatePrivateKey'
);

// setCertificateMaterialized stamps materialized_at once the on-disk write succeeds
assert.equal(getCertificate(cert.id, db)!.materializedAt, null, 'materializedAt starts null');
setCertificateMaterialized(cert.id, db);
assert.ok((getCertificate(cert.id, db)!.materializedAt ?? 0) > 0, 'materializedAt set');

// account-delete guard
assert.equal(certificatesUsingAccount('a1', db), 1, 'one cert uses a1');
assert.equal(certificatesUsingAccount('nope', db), 0, 'none for other account');

assert.equal(deleteCertificate(cert.id, db), true, 'deleted');
assert.equal(getCertificate(cert.id, db), undefined, 'gone');

// createCertificate refuses an unknown acme_account_id
assert.throws(
  () => createCertificate({ name: 'bad', acmeAccountId: 'nope', connectionId: 'c1', sans: ['example.org'] }, db),
  /unknown acme_account_id/,
  'unknown acme_account_id rejected'
);

// createCertificate refuses an unsafe/invalid name (same rules materialize.ts
// enforces on-disk — validated up front so a bad name never reaches the fs)
assert.throws(
  () => createCertificate({ name: '../evil', acmeAccountId: 'a1', connectionId: 'c1', sans: ['example.org'] }, db),
  /invalid certificate name/,
  'invalid certificate name rejected'
);

console.log('certs/cert-store: ALL PASSED');
