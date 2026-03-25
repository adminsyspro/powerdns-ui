import { randomBytes, createHash, timingSafeEqual } from 'crypto';

const TOKEN_BYTES = 48; // 96 hex chars

/**
 * Generate a cryptographically random proxy token.
 * Returns a 96-character hex string.
 */
export function generateProxyToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Compute SHA-512 hash of a token (hex-encoded, 128 chars).
 * Compatible with powerdns-api-proxy token_sha512 format.
 */
export function hashToken(token: string): string {
  return createHash('sha512').update(token).digest('hex');
}

/**
 * Verify a token against a stored SHA-512 hash using timing-safe comparison.
 */
export function verifyToken(token: string, storedHash: string): boolean {
  const computedHash = hashToken(token);
  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
