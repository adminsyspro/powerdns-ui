import { scrypt, randomBytes, timingSafeEqual, scryptSync } from 'crypto';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

/**
 * Hash a password using scrypt with a random salt.
 * Returns "salt:hash" both hex-encoded.
 */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LENGTH);
    scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored "salt:hash" string.
 */
export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return resolve(false);

    const salt = Buffer.from(saltHex, 'hex');
    const storedKey = Buffer.from(hashHex, 'hex');

    scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(timingSafeEqual(storedKey, derivedKey));
    });
  });
}

/**
 * Synchronous hash for use at startup (seed only).
 */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}
