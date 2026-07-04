import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { encrypt, decryptStrict } from '@/lib/crypto';
import { certificatesUsingAccount } from './cert-store';
import type {
  AcmeAccount, AcmeAccountInput, AcmeAccountPatch, AcmeAccountSecrets,
} from './types';

type Db = Database.Database;

// Columns safe to read into the domain object (NO secret columns).
const SAFE_COLS =
  `id, name, ca_type, directory_url, contact_email, eab_kid,
   (eab_hmac_key IS NOT NULL) AS has_eab, (account_key_pem IS NOT NULL) AS has_key,
   account_url, tos_agreed, tos_agreed_at, root_fingerprint_sha256,
   propagation_mode, propagation_resolver, status, last_error, created_at, updated_at`;

function rowToAccount(r: any): AcmeAccount {
  return {
    id: r.id, name: r.name, caType: r.ca_type, directoryUrl: r.directory_url,
    contactEmail: r.contact_email, eabKid: r.eab_kid ?? null,
    hasEabHmac: !!r.has_eab, hasAccountKey: !!r.has_key,
    accountUrl: r.account_url ?? null,
    tosAgreed: r.tos_agreed === 1, tosAgreedAt: r.tos_agreed_at ?? null,
    rootFingerprintSha256: r.root_fingerprint_sha256 ?? null,
    propagationMode: r.propagation_mode, propagationResolver: r.propagation_resolver ?? null,
    status: r.status, lastError: r.last_error ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createAcmeAccount(input: AcmeAccountInput, db: Db = getDb()): AcmeAccount {
  const id = randomUUID();
  const tosAgreed = input.tosAgreed ? 1 : 0;
  db.prepare(
    `INSERT INTO acme_accounts
      (id, name, ca_type, directory_url, contact_email, eab_kid, eab_hmac_key,
       root_pem, root_fingerprint_sha256, propagation_mode, propagation_resolver,
       tos_agreed, tos_agreed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.caType, input.directoryUrl, input.contactEmail ?? '',
    input.eabKid ?? null,
    input.eabHmacKey ? encrypt(input.eabHmacKey) : null,
    input.rootPem ?? null, input.rootFingerprintSha256 ?? null,
    input.propagationMode ?? 'authoritative', input.propagationResolver ?? null,
    tosAgreed, tosAgreed ? Math.floor(Date.now() / 1000) : null,
  );
  return getAcmeAccount(id, db)!;
}

export function listAcmeAccounts(db: Db = getDb()): AcmeAccount[] {
  return db.prepare(`SELECT ${SAFE_COLS} FROM acme_accounts ORDER BY name`).all().map(rowToAccount);
}

export function getAcmeAccount(id: string, db: Db = getDb()): AcmeAccount | undefined {
  const r = db.prepare(`SELECT ${SAFE_COLS} FROM acme_accounts WHERE id = ?`).get(id);
  return r ? rowToAccount(r) : undefined;
}

export function getAcmeAccountByName(name: string, db: Db = getDb()): AcmeAccount | undefined {
  const r = db.prepare(`SELECT ${SAFE_COLS} FROM acme_accounts WHERE name = ?`).get(name);
  return r ? rowToAccount(r) : undefined;
}

/**
 * Public-CA roots pinned to accounts, for the ACME trust interceptor.
 * root_pem is a public certificate (not a secret), so it is safe to read here;
 * it is deliberately NOT part of SAFE_COLS (which feeds the API domain object).
 */
export function listTrustedRoots(db: Db = getDb()): { directoryUrl: string; rootPem: string }[] {
  return db
    .prepare(`SELECT directory_url AS directoryUrl, root_pem AS rootPem
              FROM acme_accounts WHERE root_pem IS NOT NULL AND root_pem != ''`)
    .all() as { directoryUrl: string; rootPem: string }[];
}

export function updateAcmeAccount(id: string, patch: AcmeAccountPatch, db: Db = getDb()): AcmeAccount | undefined {
  const existing = db.prepare(`SELECT * FROM acme_accounts WHERE id = ?`).get(id) as any;
  if (!existing) return undefined;
  const tosAgreed = patch.tosAgreed === undefined ? existing.tos_agreed : (patch.tosAgreed ? 1 : 0);
  let tosAgreedAt = existing.tos_agreed_at;
  if (patch.tosAgreed === false) {
    tosAgreedAt = null;
  } else if (patch.tosAgreed === true && existing.tos_agreed !== 1) {
    tosAgreedAt = Math.floor(Date.now() / 1000);
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE acme_accounts SET
         name = ?, contact_email = ?, directory_url = ?, eab_kid = ?,
         root_pem = ?, root_fingerprint_sha256 = ?, propagation_mode = ?, propagation_resolver = ?,
         tos_agreed = ?, tos_agreed_at = ?, updated_at = unixepoch()
       WHERE id = ?`
    ).run(
      patch.name ?? existing.name,
      patch.contactEmail ?? existing.contact_email,
      patch.directoryUrl ?? existing.directory_url,
      patch.eabKid === undefined ? existing.eab_kid : patch.eabKid,
      patch.rootPem === undefined ? existing.root_pem : patch.rootPem,
      patch.rootFingerprintSha256 === undefined ? existing.root_fingerprint_sha256 : patch.rootFingerprintSha256,
      patch.propagationMode ?? existing.propagation_mode,
      patch.propagationResolver === undefined ? existing.propagation_resolver : patch.propagationResolver,
      tosAgreed, tosAgreedAt, id,
    );
    if (patch.eabHmacKey !== undefined) {
      db.prepare(`UPDATE acme_accounts SET eab_hmac_key = ?, updated_at = unixepoch() WHERE id = ?`)
        .run(patch.eabHmacKey ? encrypt(patch.eabHmacKey) : null, id);
    }
  })();
  return getAcmeAccount(id, db);
}

export function deleteAcmeAccount(id: string, db: Db = getDb()): boolean {
  return db.prepare(`DELETE FROM acme_accounts WHERE id = ?`).run(id).changes > 0;
}

/**
 * Delete an ACME account only if no certificate references it, atomically —
 * the existence check, in-use count, and DELETE all run inside one
 * transaction so a concurrent createCertificate() can't sneak in between the
 * count and the delete and leave a certificate pointing at a deleted account.
 */
export function deleteAcmeAccountIfUnused(
  id: string,
  db: Db = getDb()
): { result: 'deleted' | 'in-use' | 'not-found'; inUse?: number } {
  return db.transaction(() => {
    const existing = db.prepare(`SELECT 1 FROM acme_accounts WHERE id = ?`).get(id);
    if (!existing) return { result: 'not-found' as const };
    const inUse = certificatesUsingAccount(id, db);
    if (inUse > 0) return { result: 'in-use' as const, inUse };
    db.prepare(`DELETE FROM acme_accounts WHERE id = ?`).run(id);
    return { result: 'deleted' as const };
  })();
}

export function getAccountSecrets(id: string, db: Db = getDb()): AcmeAccountSecrets | undefined {
  const r = db.prepare(`SELECT account_key_pem, eab_hmac_key FROM acme_accounts WHERE id = ?`).get(id) as any;
  if (!r) return undefined;
  return {
    accountKeyPem: r.account_key_pem ? decryptStrict(r.account_key_pem) : null,
    eabHmacKey: r.eab_hmac_key ? decryptStrict(r.eab_hmac_key) : null,
  };
}

export function setAccountRegistration(
  id: string,
  reg: { accountKeyPem: string; accountUrl: string; status: 'registered' | 'error'; clearEab: boolean },
  db: Db = getDb()
): void {
  db.prepare(
    `UPDATE acme_accounts SET account_key_pem = ?, account_url = ?, status = ?,
       eab_hmac_key = CASE WHEN ? = 1 THEN NULL ELSE eab_hmac_key END,
       last_error = NULL, updated_at = unixepoch()
     WHERE id = ?`
  ).run(encrypt(reg.accountKeyPem), reg.accountUrl, reg.status, reg.clearEab ? 1 : 0, id);
}
