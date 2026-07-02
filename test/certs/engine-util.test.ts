import assert from 'node:assert';
import { classifyError, groupChallengesByFqdn, backoffDelayMs } from '../../src/lib/certs/engine-util';

// apex + wildcard collapse to one fqdn with two values
const grouped = groupChallengesByFqdn([
  { fqdn: '_acme-challenge.example.com.', value: 'A' },
  { fqdn: '_acme-challenge.example.com.', value: 'B' },
  { fqdn: '_acme-challenge.sub.example.com.', value: 'C' },
]);
assert.deepEqual(grouped.get('_acme-challenge.example.com.'), ['A', 'B'], 'two values same fqdn');
assert.deepEqual(grouped.get('_acme-challenge.sub.example.com.'), ['C'], 'single value');

// error classification
assert.equal(classifyError(new Error('rateLimited: too many certificates')).errorClass, 'rate-limit', 'rate limit');
assert.equal(classifyError(new Error('DNS problem: NXDOMAIN looking up TXT')).errorClass, 'propagation', 'propagation');
assert.equal(classifyError(new Error('something weird')).errorClass, 'unknown', 'unknown fallback');
assert.ok(classifyError(new Error('rateLimited')).retryDelayMs >= 3_600_000, 'rate-limit backs off long');

// backoff is capped exponential
assert.ok(backoffDelayMs(1, 60_000, 3_600_000) < backoffDelayMs(3, 60_000, 3_600_000), 'grows with attempt');
assert.equal(backoffDelayMs(99, 60_000, 3_600_000), 3_600_000, 'capped at max');

console.log('certs/engine-util: ALL PASSED');
