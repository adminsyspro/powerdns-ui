import assert from 'node:assert';
import { encrypt, decryptStrict } from '../../src/lib/certs/../crypto';

// round-trips a real ciphertext
const ct = encrypt('super-secret-key-material');
assert.equal(decryptStrict(ct), 'super-secret-key-material', 'round-trips valid ciphertext');

// throws on garbage / plaintext (NOT the lenient return-input behaviour)
assert.throws(() => decryptStrict('not-encrypted-plaintext'), /decrypt/i, 'throws on non-ciphertext');
assert.throws(() => decryptStrict(''), /decrypt/i, 'throws on empty');
// tampered ciphertext (flip last char) must fail the auth tag
const tampered = ct.slice(0, -2) + (ct.endsWith('A') ? 'B' : 'A') + '=';
assert.throws(() => decryptStrict(tampered), /decrypt/i, 'throws on tampered ciphertext');

console.log('certs/decrypt-strict: ALL PASSED');
