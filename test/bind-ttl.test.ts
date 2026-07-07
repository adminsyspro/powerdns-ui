import assert from 'node:assert';
import { parseBind } from '../src/lib/bind/parser';

// Regression tests for TTL token parsing. The unit-group regex moved from a
// global scan to a sticky (contiguous) scan to avoid polynomial backtracking.
// Behavior must stay identical: a TTL token is valid only when digit+unit
// groups cover the whole token, or the token is purely numeric.

// Plain numeric TTL.
{
  const p = parseBind('$ORIGIN example.com.\n$TTL 300\nwww A 192.0.2.1\n');
  assert.deepEqual(p.errors, []);
  assert.equal(p.rrsets[0].ttl, 300);
}

// Unit-based TTLs via $TTL (lowercase, uppercase, repeated units).
const valid: Array<[string, number]> = [
  ['1h30m', 5400],
  ['1H30M', 5400],
  ['2h', 7200],
  ['1w', 604800],
  ['1m1m', 120],
];
for (const [token, seconds] of valid) {
  const p = parseBind(`$ORIGIN example.com.\n$TTL ${token}\nwww A 192.0.2.1\n`);
  assert.deepEqual(p.errors, [], `unexpected errors for "${token}"`);
  assert.equal(p.rrsets[0].ttl, seconds, `ttl for "${token}"`);
}

// Record-level TTL token.
{
  const p = parseBind('$ORIGIN example.com.\nwww 2h IN A 192.0.2.1\n');
  assert.deepEqual(p.errors, []);
  assert.equal(p.rrsets[0].ttl, 7200);
}

// Invalid TTL tokens: trailing digits without a unit, leading unit, junk in
// or after the unit groups.
for (const bad of ['1h30', 'h30m', '90x', '1h30m!']) {
  const p = parseBind(`$TTL ${bad}\n`);
  assert.ok(p.errors.length >= 1, `expected error for "${bad}"`);
  assert.ok(p.errors[0].message.startsWith('$TTL invalid'), p.errors[0].message);
}

// Pathological token (unit group followed by a huge digit run without a
// unit) used to trigger quadratic rescanning; it must fail fast now.
{
  const start = Date.now();
  const p = parseBind(`$TTL 1h${'9'.repeat(50000)}\n`);
  assert.equal(p.errors.length, 1);
  assert.ok(p.errors[0].message.startsWith('$TTL invalid'), p.errors[0].message);
  assert.ok(Date.now() - start < 2000, 'parseTtl should run in linear time');
}

console.log('bind-ttl: ALL PASSED');
