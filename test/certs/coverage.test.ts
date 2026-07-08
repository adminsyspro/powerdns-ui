import assert from 'node:assert';
import type { Certificate } from '../../src/lib/certs/types';
import { sanCoversHost, certCoverageStatus, findBestCoverage } from '../../src/lib/certs/coverage';

const DAY = 86400000;
function mk(p: Partial<Certificate>): Certificate {
  return {
    id: 'c1', name: 'c1', acmeAccountId: 'a', connectionId: 'conn', serverUrl: 'http://p',
    sans: ['www.example.com'], keyType: 'ecdsa', status: 'valid', renewalStatus: 'idle',
    lastRenewalError: null, errorClass: null, nextAttemptAt: null,
    notBefore: null, notAfter: Math.floor((Date.now() + 90 * DAY) / 1000),
    serial: null, fingerprintSha256: null, issuer: null, hasCert: true,
    keyDownloadEnabled: true, autoRenew: true, renewBeforeDays: 30,
    category: null, comment: null, lastRunLog: null, lastIssuedAt: 1000,
    lastRenewalSuccessAt: null, materializedAt: null, createdAt: 1, updatedAt: 2,
    ...p,
  };
}

// --- sanCoversHost ---
assert.deepEqual(sanCoversHost('www.example.com', 'www.example.com'), { exact: true }, 'exact match');
assert.deepEqual(sanCoversHost('*.example.com', 'www.example.com'), { exact: false }, 'wildcard covers one label');
assert.equal(sanCoversHost('*.example.com', 'a.b.example.com'), null, 'wildcard is single-label only');
assert.equal(sanCoversHost('*.example.com', 'example.com'), null, 'wildcard does not cover apex');
assert.deepEqual(sanCoversHost('WWW.example.com.', 'www.example.com'), { exact: true }, 'case/trailing-dot insensitive');

// --- certCoverageStatus ---
assert.equal(certCoverageStatus(mk({ status: 'valid' })), 'valid', 'fresh valid');
assert.equal(certCoverageStatus(mk({ status: 'valid', notAfter: Math.floor((Date.now() + 10 * DAY) / 1000) })), 'expiring', 'within renewBeforeDays → expiring');
assert.equal(certCoverageStatus(mk({ status: 'valid', notAfter: null })), 'valid', 'null notAfter → valid (no false expiring)');
assert.equal(certCoverageStatus(mk({ status: 'pending', renewalStatus: 'running' })), 'pending', 'in progress → pending');
assert.equal(certCoverageStatus(mk({ status: 'pending', renewalStatus: 'failed' })), 'error', 'failed pending → error');
assert.equal(certCoverageStatus(mk({ status: 'error' })), 'error', 'error → error');

// --- findBestCoverage ---
assert.equal(findBestCoverage([], 'www.example.com'), null, 'no certs → null');
assert.equal(
  findBestCoverage([mk({ id: 'wc', sans: ['*.example.com'] })], 'www.example.com')!.certId,
  'wc', 'wildcard cert covers the host',
);
// exact beats wildcard even if the wildcard is more recent
const exactVsWc = findBestCoverage([
  mk({ id: 'wc', sans: ['*.example.com'], lastIssuedAt: 9999 }),
  mk({ id: 'exact', sans: ['www.example.com'], lastIssuedAt: 1 }),
], 'www.example.com');
assert.equal(exactVsWc!.certId, 'exact', 'exact match ranked before wildcard');
// valid beats a redundant pending on the same host
const validVsPending = findBestCoverage([
  mk({ id: 'p', sans: ['www.example.com'], status: 'pending', renewalStatus: 'running' }),
  mk({ id: 'v', sans: ['www.example.com'], status: 'valid' }),
], 'www.example.com');
assert.equal(validVsPending!.status, 'valid', 'best usable coverage = valid wins');

console.log('certs/coverage: ALL PASSED');
