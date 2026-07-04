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

/** Whether the bundled internal CA (step-ca) integration is enabled. Requires certs enabled. */
export function isInternalCaEnabled(): boolean {
  return isCertsEnabled() && process.env.INTERNAL_CA_ENABLED === 'true';
}

/** ACME directory URL of the bundled step-ca, e.g. https://step-ca:9000/acme/acme/directory. */
export function getInternalCaDirectoryUrl(): string | null {
  return process.env.INTERNAL_CA_DIRECTORY_URL || null;
}

/** Path to the bundled CA's PUBLIC root cert (read-only mount), used for auto-pin. */
export function getInternalCaRootFile(): string | null {
  return process.env.INTERNAL_CA_ROOT_FILE || null;
}

/** Path to the bundled CA's PUBLIC intermediate cert (for expiry display). */
export function getInternalCaIntermediateFile(): string | null {
  return process.env.INTERNAL_CA_INTERMEDIATE_FILE || null;
}

/** Internal resolver the app polls for DNS-01 propagation of internal zones. */
export function getInternalCaPropagationResolver(): string | null {
  return process.env.INTERNAL_CA_PROPAGATION_RESOLVER || null;
}
