import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import {
  isInternalCaEnabled, getInternalCaDirectoryUrl, getInternalCaRootFile,
  getInternalCaIntermediateFile, getInternalCaPropagationResolver,
} from './config';
import { getAcmeAccountByName, createAcmeAccount, updateAcmeAccount } from './store';
import { registerAccount } from './acme-account';
import { reloadAcmeTrust, fingerprintSha256 } from './acme-trust';
import type { AcmeAccount, InternalCaStatus } from './types';

type Db = Database.Database;

/** Reserved singleton name for the bundled step-ca ACME account. */
export const BUNDLED_ACCOUNT_NAME = 'internal-step-ca';

/** Read a public cert file; returns null (never throws) if unset/missing/invalid. */
export function readCertMeta(path: string | null): { pem: string; fingerprint: string; notAfter: number } | null {
  if (!path) return null;
  try {
    const pem = readFileSync(path, 'utf8');
    const x = new X509Certificate(pem);
    const notAfter = Math.floor(Date.parse(x.validTo) / 1000);
    return { pem, fingerprint: fingerprintSha256(pem), notAfter };
  } catch {
    return null;
  }
}

/** Setup is possible when the feature is on, the directory URL is set, and the root file is readable. */
export function internalCaReady(): boolean {
  return isInternalCaEnabled() && !!getInternalCaDirectoryUrl() && !!readCertMeta(getInternalCaRootFile());
}

/**
 * Upsert the singleton bundled account by its reserved name (never a second insert),
 * so repeated setup / root rotation updates one row and can't collide with name UNIQUE.
 */
export function reconcileBundledAccount(
  args: { directoryUrl: string; rootPem: string; rootFingerprintSha256: string; propagationResolver: string | null },
  db: Db = getDb(),
): AcmeAccount {
  const existing = getAcmeAccountByName(BUNDLED_ACCOUNT_NAME, db);
  if (existing) {
    return updateAcmeAccount(existing.id, {
      directoryUrl: args.directoryUrl,
      rootPem: args.rootPem,
      rootFingerprintSha256: args.rootFingerprintSha256,
      propagationMode: 'resolver',
      propagationResolver: args.propagationResolver,
      tosAgreed: true,
    }, db)!;
  }
  return createAcmeAccount({
    name: BUNDLED_ACCOUNT_NAME,
    caType: 'step-ca',
    directoryUrl: args.directoryUrl,
    rootPem: args.rootPem,
    rootFingerprintSha256: args.rootFingerprintSha256,
    propagationMode: 'resolver',
    propagationResolver: args.propagationResolver,
    tosAgreed: true,
  }, db);
}

/** Read-only status for the "Internal CA" panel. */
export function internalCaStatus(db: Db = getDb()): InternalCaStatus {
  const root = readCertMeta(getInternalCaRootFile());
  const inter = readCertMeta(getInternalCaIntermediateFile());
  const account = getAcmeAccountByName(BUNDLED_ACCOUNT_NAME, db) ?? null;
  return {
    enabled: isInternalCaEnabled(),
    ready: internalCaReady(),
    directoryUrl: getInternalCaDirectoryUrl(),
    rootPem: root?.pem ?? null,
    rootFingerprintSha256: root?.fingerprint ?? null,
    rootNotAfter: root?.notAfter ?? null,
    intermediateNotAfter: inter?.notAfter ?? null,
    account: account ? { id: account.id, name: account.name, status: account.status } : null,
  };
}

/** Orchestrate one-click setup: auto-pin from the mounted root, upsert the account, register it. */
export async function runInternalCaSetup(): Promise<AcmeAccount> {
  if (!internalCaReady()) {
    throw Object.assign(new Error('internal CA not ready (step-ca not up or root file not yet written)'), { retryable: true });
  }
  const root = readCertMeta(getInternalCaRootFile())!;
  const account = reconcileBundledAccount({
    directoryUrl: getInternalCaDirectoryUrl()!,
    rootPem: root.pem,
    rootFingerprintSha256: root.fingerprint,
    propagationResolver: getInternalCaPropagationResolver(),
  });
  reloadAcmeTrust();            // trust the root before registering with step-ca
  return registerAccount(account.id);
}
