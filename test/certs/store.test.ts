import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  createAcmeAccount, listAcmeAccounts, getAcmeAccount,
  updateAcmeAccount, deleteAcmeAccount, deleteAcmeAccountIfUnused, getAccountSecrets, setAccountRegistration,
} from '../../src/lib/certs/store';

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
  );
  CREATE TABLE certificates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, acme_account_id TEXT NOT NULL
  );`);
  return db;
}

const db = makeDb();
const created = createAcmeAccount({
  name: 'le-staging', caType: 'letsencrypt',
  directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
  contactEmail: 'a@b.c', eabHmacKey: 'supersecret', tosAgreed: true,
}, db);
assert.ok(created.id, 'has id');
assert.equal(created.tosAgreed, true, 'tos stored');
assert.ok(created.tosAgreedAt && created.tosAgreedAt > 0, 'tosAgreedAt set when agreed');
assert.equal(created.hasEabHmac, true, 'eab presence flag');
assert.equal((created as any).eabHmacKey, undefined, 'secret NOT on returned object');

// list/get omit secrets
const listed = listAcmeAccounts(db);
assert.equal(listed.length, 1, 'one account listed');
assert.equal((listed[0] as any).eab_hmac_key, undefined, 'no raw secret column leaked');

// secrets only via dedicated getter, decrypted
const secrets = getAccountSecrets(created.id, db)!;
assert.equal(secrets.eabHmacKey, 'supersecret', 'eab decrypts back');

// raw DB column is encrypted (not the plaintext)
const rawEab = (db.prepare('SELECT eab_hmac_key FROM acme_accounts WHERE id=?').get(created.id) as any).eab_hmac_key;
assert.notEqual(rawEab, 'supersecret', 'eab stored encrypted at rest');

// update
const upd = updateAcmeAccount(created.id, { contactEmail: 'z@z.z', propagationMode: 'resolver' }, db)!;
assert.equal(upd.contactEmail, 'z@z.z', 'update applied');
assert.equal(upd.propagationMode, 'resolver', 'propagation updated');

// un-agreeing ToS clears tosAgreedAt
const unagreed = updateAcmeAccount(created.id, { tosAgreed: false }, db)!;
assert.equal(unagreed.tosAgreed, false, 'tosAgreed cleared');
assert.equal(unagreed.tosAgreedAt, null, 'tosAgreedAt cleared');

// registration setter
setAccountRegistration(created.id, { accountKeyPem: '-----KEY-----', accountUrl: 'https://acct/1', status: 'registered', clearEab: true }, db);
const afterReg = getAcmeAccount(created.id, db)!;
assert.equal(afterReg.status, 'registered', 'status registered');
assert.equal(afterReg.accountUrl, 'https://acct/1', 'account url stored');
assert.equal(afterReg.hasAccountKey, true, 'account key present');
assert.equal(getAccountSecrets(created.id, db)!.eabHmacKey, null, 'eab cleared after registration');
assert.equal(getAccountSecrets(created.id, db)!.accountKeyPem, '-----KEY-----', 'account key decrypts');

// delete
assert.equal(deleteAcmeAccount(created.id, db), true, 'delete returns true');
assert.equal(getAcmeAccount(created.id, db), undefined, 'gone after delete');
assert.equal(deleteAcmeAccount('missing', db), false, 'delete missing returns false');

// deleteAcmeAccountIfUnused: atomic guard against deleting an in-use account
const unused = createAcmeAccount({
  name: 'unused-acct', caType: 'letsencrypt',
  directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
}, db);
assert.deepEqual(deleteAcmeAccountIfUnused(unused.id, db), { result: 'deleted' }, 'unused account deleted');
assert.equal(getAcmeAccount(unused.id, db), undefined, 'unused account gone');

const inUseAcct = createAcmeAccount({
  name: 'in-use-acct', caType: 'letsencrypt',
  directoryUrl: 'https://acme-staging-v02.api.letsencrypt.org/directory',
}, db);
db.prepare(`INSERT INTO certificates (id, name, acme_account_id) VALUES ('cert1','web',?)`).run(inUseAcct.id);
assert.deepEqual(
  deleteAcmeAccountIfUnused(inUseAcct.id, db),
  { result: 'in-use', inUse: 1 },
  'in-use account refused with count'
);
assert.ok(getAcmeAccount(inUseAcct.id, db), 'in-use account NOT deleted');

assert.deepEqual(deleteAcmeAccountIfUnused('missing', db), { result: 'not-found' }, 'missing account not-found');

console.log('certs/store: ALL PASSED');
