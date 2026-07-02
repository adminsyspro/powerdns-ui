import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  createCertificate, getCertificate, listCertificates, getCertificatePrivateKey,
  updateCertificateIssuance, setCertificateRenewalFailure, deleteCertificate, certificatesUsingAccount,
} from '../../src/lib/certs/cert-store';

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

console.log('certs/cert-store: ALL PASSED');
