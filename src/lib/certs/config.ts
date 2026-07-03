/** Server-side feature flag for the SSL-certificates subsystem. */
export function isCertsEnabled(): boolean {
  return process.env.CERTS_ENABLED === 'true';
}

/** Filesystem root under which issued certs are materialized (live/<name>/...). */
export function getCertsDir(): string {
  return process.env.CERTS_DIR || '/data/certs';
}

/**
 * Whether the background renewal worker should run. Requires certs enabled;
 * defaults ON when certs are on (opt-out via CERT_RENEWAL_ENABLED=false).
 */
export function isCertRenewalEnabled(): boolean {
  return isCertsEnabled() && process.env.CERT_RENEWAL_ENABLED !== 'false';
}
