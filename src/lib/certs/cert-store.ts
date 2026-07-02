import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { encrypt, decryptStrict } from '@/lib/crypto';
import { canonicalizeSans } from './san';
import { normalizeUrl } from '@/lib/cache/zones';
import type { Certificate, KeyType } from './types';

type Db = Database.Database;

// Columns safe to read into the domain object (NO secret/PEM columns).
// cert presence is exposed as a boolean flag, like the accounts store's has_key.
const SAFE_COLS =
  `id, name, acme_account_id, connection_id, server_url, sans_json, key_type, status,
   renewal_status, last_renewal_error, error_class, next_attempt_at, not_before, not_after,
   serial, fingerprint_sha256, issuer, (cert_pem IS NOT NULL) AS has_cert,
   key_download_enabled, auto_renew, renew_before_days, last_issued_at,
   last_renewal_success_at, materialized_at, created_at, updated_at`;

function rowToCertificate(r: any): Certificate {
  return {
    id: r.id, name: r.name, acmeAccountId: r.acme_account_id,
    connectionId: r.connection_id, serverUrl: r.server_url,
    sans: JSON.parse(r.sans_json), keyType: r.key_type,
    status: r.status, renewalStatus: r.renewal_status,
    lastRenewalError: r.last_renewal_error ?? null, errorClass: r.error_class ?? null,
    nextAttemptAt: r.next_attempt_at ?? null,
    notBefore: r.not_before ?? null, notAfter: r.not_after ?? null,
    serial: r.serial ?? null, fingerprintSha256: r.fingerprint_sha256 ?? null,
    issuer: r.issuer ?? null, hasCert: !!r.has_cert,
    keyDownloadEnabled: r.key_download_enabled === 1, autoRenew: r.auto_renew === 1,
    renewBeforeDays: r.renew_before_days,
    lastIssuedAt: r.last_issued_at ?? null, lastRenewalSuccessAt: r.last_renewal_success_at ?? null,
    materializedAt: r.materialized_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createCertificate(
  input: {
    name: string; acmeAccountId: string; connectionId: string; sans: string[];
    keyType?: KeyType; autoRenew?: boolean; renewBeforeDays?: number;
  },
  db: Db = getDb()
): Certificate {
  const sans = canonicalizeSans(input.sans);
  const account = db.prepare(`SELECT 1 FROM acme_accounts WHERE id = ?`).get(input.acmeAccountId);
  if (!account) throw new Error('unknown acme_account_id');
  // Resolve the server URL from the SAME (injected) db so the DI seam stays
  // consistent; getConnectionById() is hard-wired to the global getDb().
  const conn = db.prepare(`SELECT url FROM server_connections WHERE id = ?`).get(input.connectionId) as
    | { url: string }
    | undefined;
  if (!conn) throw new Error(`connection not found: ${input.connectionId}`);
  const serverUrl = normalizeUrl(conn.url);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO certificates
      (id, name, acme_account_id, connection_id, server_url, sans_json, key_type, auto_renew, renew_before_days)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.acmeAccountId, input.connectionId, serverUrl,
    JSON.stringify(sans), input.keyType ?? 'ecdsa',
    input.autoRenew === false ? 0 : 1, input.renewBeforeDays ?? 30,
  );
  return getCertificate(id, db)!;
}

export function listCertificates(db: Db = getDb()): Certificate[] {
  return db.prepare(`SELECT ${SAFE_COLS} FROM certificates ORDER BY name`).all().map(rowToCertificate);
}

export function getCertificate(id: string, db: Db = getDb()): Certificate | undefined {
  const r = db.prepare(`SELECT ${SAFE_COLS} FROM certificates WHERE id = ?`).get(id);
  return r ? rowToCertificate(r) : undefined;
}

export function getCertificatePrivateKey(id: string, db: Db = getDb()): string | null {
  const row = db.prepare(`SELECT privkey_enc FROM certificates WHERE id = ?`).get(id) as any;
  if (!row || !row.privkey_enc) return null;
  return decryptStrict(row.privkey_enc);
}

export function updateCertificateIssuance(
  id: string,
  opts: {
    certPem: string; chainPem: string; privkeyPem: string;
    notBefore: number; notAfter: number; serial: string; fingerprint: string; issuer: string;
  },
  db: Db = getDb()
): void {
  db.prepare(
    `UPDATE certificates SET
       cert_pem = ?, chain_pem = ?, privkey_enc = ?,
       not_before = ?, not_after = ?, serial = ?, fingerprint_sha256 = ?, issuer = ?,
       status = 'valid', renewal_status = 'idle', last_renewal_error = NULL, error_class = NULL,
       last_issued_at = unixepoch(), last_renewal_success_at = unixepoch(), updated_at = unixepoch()
     WHERE id = ?`
  ).run(
    opts.certPem, opts.chainPem, encrypt(opts.privkeyPem),
    opts.notBefore, opts.notAfter, opts.serial, opts.fingerprint, opts.issuer, id,
  );
}

export function setCertificateRenewalFailure(
  id: string,
  opts: { errorClass: string; message: string; nextAttemptAt: number },
  db: Db = getDb()
): void {
  db.prepare(
    `UPDATE certificates SET
       renewal_status = 'failed', last_renewal_error = ?, error_class = ?,
       next_attempt_at = ?, updated_at = unixepoch()
     WHERE id = ?`
  ).run(opts.message, opts.errorClass, opts.nextAttemptAt, id);
}

export function deleteCertificate(id: string, db: Db = getDb()): boolean {
  return db.prepare(`DELETE FROM certificates WHERE id = ?`).run(id).changes > 0;
}

export function certificatesUsingAccount(acmeAccountId: string, db: Db = getDb()): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE acme_account_id = ?`).get(acmeAccountId);
  return (row as any).n as number;
}

export function updateCertificateSettings(
  id: string,
  patch: { autoRenew?: boolean; renewBeforeDays?: number; keyDownloadEnabled?: boolean },
  db: Db = getDb()
): Certificate | undefined {
  const existing = db.prepare(`SELECT 1 FROM certificates WHERE id = ?`).get(id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE certificates SET
       auto_renew = COALESCE(?, auto_renew),
       renew_before_days = COALESCE(?, renew_before_days),
       key_download_enabled = COALESCE(?, key_download_enabled),
       updated_at = unixepoch()
     WHERE id = ?`
  ).run(
    patch.autoRenew === undefined ? null : (patch.autoRenew ? 1 : 0),
    patch.renewBeforeDays === undefined ? null : patch.renewBeforeDays,
    patch.keyDownloadEnabled === undefined ? null : (patch.keyDownloadEnabled ? 1 : 0),
    id,
  );
  return getCertificate(id, db);
}
