/**
 * Certificate name helpers — shared by the certificate dialogs. Client-safe
 * (no server imports). Mirrors the server-side sanitizeCertName() in
 * materialize.ts: the name is a folder on disk — lowercase [a-z0-9._-], must
 * start and end with a letter or digit, ≤128 chars.
 */
export const CERT_NAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/** Keep a name field to the allowed charset as the user types (spaces → '-'). */
export function slugifyCertName(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
}

/** Report the residual format rules (null when valid or still empty). */
export function certNameFormatError(raw: string): string | null {
  const n = raw.trim().toLowerCase();
  if (!n) return null; // presence is enforced on submit
  if (n.length > 128) return 'Name must be 128 characters or fewer.';
  if (!CERT_NAME_RE.test(n)) {
    return 'Lowercase letters, digits, . _ - only — and it must start and end with a letter or digit.';
  }
  return null;
}

/**
 * Auto-derive a cert name from a SAN or a zone name. A leading wildcard `*.`
 * becomes `wildcard.` BEFORE slugifying (so `*.example.com` →
 * `wildcard-example-com`, never a leading-dot invalid slug), and dots become
 * hyphens for a readable folder name: `www.example.com` → `www-example-com`,
 * `example.com` → `example-com`.
 */
export function deriveCertName(source: string): string {
  const base = source.trim().toLowerCase().replace(/^\*\./, 'wildcard.').replace(/\./g, '-');
  return slugifyCertName(base);
}
