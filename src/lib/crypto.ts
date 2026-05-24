import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type Database from 'better-sqlite3';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  // APP_SECRET is the dedicated encryption-key derivation secret, separated
  // from AUTH_SECRET (which signs session JWTs). Falls back to AUTH_SECRET so
  // existing single-secret deployments keep working unchanged on first start
  // after upgrade — operators should then set APP_SECRET explicitly (to the
  // same value as AUTH_SECRET) to lock in the separation.
  // `||` (not `??`) so that an accidentally-empty env var falls through to the
  // next option rather than producing a key derived from the empty string.
  const secret =
    process.env.APP_SECRET
    || process.env.AUTH_SECRET
    || 'powerdns-ui-default-secret-change-me';
  return scryptSync(secret, 'powerdns-ui-connections', 32);
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string containing: IV + ciphertext + auth tag.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Pack: iv (12) + tag (16) + ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64-encoded string produced by encrypt().
 * If the value is not a valid encrypted payload (e.g. legacy plaintext),
 * returns it as-is so the app doesn't crash.
 */
export function decrypt(encoded: string): string {
  try {
    const key = getKey();
    const packed = Buffer.from(encoded, 'base64');

    // Minimum size: IV (12) + TAG (16) + at least 1 byte of ciphertext
    if (packed.length < IV_LENGTH + TAG_LENGTH + 1) {
      return encoded;
    }

    const iv = packed.subarray(0, IV_LENGTH);
    const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // Legacy plaintext value — return as-is
    return encoded;
  }
}


/**
 * Try to decrypt a known-encrypted row to detect a silent encryption-key change.
 *
 * `decrypt()` swallows errors and returns the input verbatim on failure (its
 * "legacy plaintext" fallback), so a healthy decrypt yields a different string
 * than the encrypted input. If they match, the GCM auth tag failed and the
 * stored value is unreadable under the current APP_SECRET / AUTH_SECRET.
 *
 * Run once at startup (after `initSchema` / `seedDefaultAdmin`). If `ok` is
 * false, log the message at warn level — do not crash, the admin needs the app
 * up to recover via the Settings UI.
 */
export function cryptoSanityCheck(
  db: Database.Database
): { ok: boolean; message: string } {
  const row = db
    .prepare(
      "SELECT value FROM app_settings WHERE key = 'ldap_bind_password' AND value != ''"
    )
    .get() as { value: string } | undefined;

  if (!row || !row.value) {
    return {
      ok: true,
      message: 'No encrypted secrets to verify — skipping crypto sanity check.',
    };
  }

  // Heuristic: an encrypted blob is at least 29 bytes (12 IV + 16 TAG + ≥1 CT)
  // after base64-decoding. Shorter values are pre-encryption legacy plaintext
  // and decrypt() returns them as-is, which would otherwise look like failure.
  const buf = Buffer.from(row.value, 'base64');
  if (buf.length < 29) {
    return {
      ok: true,
      message: 'Stored bind password looks like legacy plaintext — skipping sanity check.',
    };
  }

  const decoded = decrypt(row.value);
  if (decoded === row.value) {
    return {
      ok: false,
      message:
        'APP_SECRET (or AUTH_SECRET fallback) appears to have changed since the ' +
        'LDAP bind password was last encrypted. The setting will be unreadable ' +
        'until the previous secret value is restored, or the password is re-entered ' +
        'via Settings → LDAP Authentication.',
    };
  }

  return { ok: true, message: 'Crypto sanity check passed.' };
}
