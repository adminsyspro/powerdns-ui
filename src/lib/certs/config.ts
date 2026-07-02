/** Server-side feature flag for the SSL-certificates subsystem. */
export function isCertsEnabled(): boolean {
  return process.env.CERTS_ENABLED === 'true';
}
