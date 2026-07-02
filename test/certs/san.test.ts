import assert from 'node:assert';
import { canonicalizeSans } from '../../src/lib/certs/san';

// lowercase + trim + strip trailing dot + dedupe, order preserved
assert.deepEqual(
  canonicalizeSans([' Example.COM ', 'example.com.', 'www.example.com']),
  ['example.com', 'www.example.com'],
  'lowercase/trim/strip-dot/dedupe'
);
// wildcard only as leftmost label
assert.deepEqual(canonicalizeSans(['*.example.com']), ['*.example.com'], 'wildcard leftmost ok');
assert.throws(() => canonicalizeSans(['a.*.example.com']), /wildcard/i, 'wildcard not leftmost rejected');
assert.throws(() => canonicalizeSans(['*.*.example.com']), /wildcard/i, 'double wildcard rejected');
// IDN → punycode
assert.deepEqual(canonicalizeSans(['exämple.com']), ['xn--exmple-cua.com'], 'IDN to punycode');
// invalid / empty rejected
assert.throws(() => canonicalizeSans(['']), /empty|invalid/i, 'empty rejected');
assert.throws(() => canonicalizeSans(['no_spaces here.com']), /invalid/i, 'invalid host rejected');
assert.throws(() => canonicalizeSans([]), /at least one/i, 'empty list rejected');

// path/port/userinfo/query/fragment smuggling rejected (would otherwise be
// silently stripped by the URL parser)
assert.throws(() => canonicalizeSans(['example.com/path']), /invalid/i, 'path smuggling rejected');
assert.throws(() => canonicalizeSans(['example.com:443']), /invalid/i, 'port smuggling rejected');
assert.throws(() => canonicalizeSans(['user@example.com']), /invalid/i, 'userinfo smuggling rejected');
// label shape
assert.throws(() => canonicalizeSans(['a.-b.com']), /invalid/i, 'leading-hyphen label rejected');
assert.throws(() => canonicalizeSans(['a.b-.com']), /invalid/i, 'trailing-hyphen label rejected');
assert.throws(() => canonicalizeSans(['a'.repeat(64) + '.com']), /invalid/i, 'over-length label rejected');
// IPv4 literal rejected
assert.throws(() => canonicalizeSans(['127.0.0.1']), /invalid/i, 'IPv4 literal rejected');
// still-valid cases
assert.deepEqual(canonicalizeSans(['*.example.com']), ['*.example.com'], 'wildcard still valid');
assert.deepEqual(canonicalizeSans(['exämple.com']), ['xn--exmple-cua.com'], 'IDN still valid');
assert.deepEqual(canonicalizeSans(['www.example.com']), ['www.example.com'], 'plain host still valid');

console.log('certs/san: ALL PASSED');
