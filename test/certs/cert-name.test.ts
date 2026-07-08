import assert from 'node:assert';
import { CERT_NAME_RE, slugifyCertName, certNameFormatError, deriveCertName } from '../../src/lib/certs/cert-name';

// slugifyCertName keeps the field to the allowed charset as the user types
assert.equal(slugifyCertName('Web Prod'), 'web-prod', 'spaces → hyphen, lowercased');
assert.equal(slugifyCertName('a/b*c'), 'abc', 'drops disallowed chars');

// certNameFormatError
assert.equal(certNameFormatError(''), null, 'empty is deferred (null)');
assert.equal(certNameFormatError('web-prod'), null, 'valid name passes');
assert.equal(certNameFormatError('-bad'), 'Lowercase letters, digits, . _ - only — and it must start and end with a letter or digit.', 'leading hyphen rejected');
assert.ok(certNameFormatError('a'.repeat(129)), 'over-length rejected');
assert.ok(CERT_NAME_RE.test('a.b_c-d'), 'regex accepts inner . _ -');

// deriveCertName — the crux: wildcard must NOT produce a leading dot
assert.equal(deriveCertName('www.example.com'), 'www-example-com', 'host derivation');
assert.equal(deriveCertName('*.example.com'), 'wildcard-example-com', 'wildcard prefix → wildcard-');
assert.equal(deriveCertName('example.com'), 'example-com', 'apex/zone derivation');
assert.equal(certNameFormatError(deriveCertName('*.example.com')), null, 'derived wildcard name is valid');

console.log('certs/cert-name: ALL PASSED');
