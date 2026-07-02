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

console.log('certs/san: ALL PASSED');
