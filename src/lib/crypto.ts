import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET || 'powerdns-ui-default-secret-change-me';
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
