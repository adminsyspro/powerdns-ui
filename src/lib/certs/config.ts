/** Server-side feature flag for the SSL-certificates subsystem. */
export function isCertsEnabled(): boolean {
  return process.env.CERTS_ENABLED === 'true';
}

/** Filesystem root under which issued certs are materialized (live/<name>/...). */
export function getCertsDir(): string {
  return process.env.CERTS_DIR || '/data/certs';
}
