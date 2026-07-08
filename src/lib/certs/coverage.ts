import type { Certificate } from './types';
import { isCertInProgress } from './types';

export type CoverageStatus = 'valid' | 'pending' | 'expiring' | 'error';
export interface CoverageEntry {
  certId: string;
  status: CoverageStatus;
}

const strip = (s: string) => s.trim().toLowerCase().replace(/\.$/, '');

/**
 * Whether a cert SAN covers a host. Returns `{ exact }` when it does — exact
 * match, or a `*.parent` wildcard exactly one label above the host — else null.
 * `*.example.com` covers `www.example.com` but not `a.b.example.com` nor the
 * apex `example.com`.
 */
export function sanCoversHost(san: string, host: string): { exact: boolean } | null {
  const s = strip(san);
  const h = strip(host);
  if (!s || !h) return null;
  if (s === h) return { exact: true };
  if (s.startsWith('*.')) {
    const suffix = s.slice(2);
    const hostLabels = h.split('.');
    if (hostLabels.length === suffix.split('.').length + 1 && h.endsWith(`.${suffix}`)) {
      return { exact: false };
    }
  }
  return null;
}

/**
 * Map one certificate to a coverage status. `notAfter` is epoch SECONDS and
 * nullable — a valid cert with null expiry stays `valid` (never a false
 * `expiring`).
 */
export function certCoverageStatus(cert: Certificate): CoverageStatus {
  if (isCertInProgress(cert)) return 'pending';
  if (cert.status === 'valid') {
    if (cert.notAfter != null && cert.notAfter * 1000 - Date.now() < cert.renewBeforeDays * 86400000) {
      return 'expiring';
    }
    return 'valid';
  }
  return 'error';
}

export const STATUS_RANK: Record<CoverageStatus, number> = { valid: 0, expiring: 1, pending: 2, error: 3 };
const recency = (c: Certificate): number => c.lastIssuedAt ?? c.updatedAt ?? c.createdAt ?? 0;

/**
 * Best certificate covering `host` among an already connection-filtered list.
 * Ranking: exact match before wildcard, then best usable status
 * (valid > expiring > pending > error), then most recently issued.
 */
export function findBestCoverage(certs: Certificate[], host: string): CoverageEntry | null {
  const cands: Array<{ cert: Certificate; exact: boolean; status: CoverageStatus }> = [];
  for (const cert of certs) {
    let covers = false;
    let exact = false;
    for (const san of cert.sans) {
      const m = sanCoversHost(san, host);
      if (m) {
        covers = true;
        if (m.exact) { exact = true; break; }
      }
    }
    if (covers) cands.push({ cert, exact, status: certCoverageStatus(cert) });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    return recency(b.cert) - recency(a.cert);
  });
  return { certId: cands[0].cert.id, status: cands[0].status };
}
