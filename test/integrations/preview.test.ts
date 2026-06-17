import assert from 'node:assert';
import { computePreviewRows, getCachedCfZones, __resetCfCache } from '../../src/lib/integrations/preview';
import type { IntegrationZoneRow } from '../../src/lib/integrations/types';
import type { CfZone } from '../../src/lib/integrations/cloudflare';

const cf = (name: string, type = 'secondary'): CfZone =>
  ({ id: 'cf-' + name, name, type, status: 'active' } as CfZone);
const tracked = (zoneName: string, status: IntegrationZoneRow['status']): IntegrationZoneRow =>
  ({ zoneName, remoteZoneId: 'r', remoteType: 'secondary', customNsSet: null, status, message: null, updatedAt: 1 });

// adopt: in PDNS + present in CF, untracked
let rows = computePreviewRows([{ name: 'a.com.', account: 'x' }], [cf('a.com')], []);
assert.equal(rows.length, 1);
assert.equal(rows[0].previewState, 'adopt');
assert.equal(rows[0].syncable, true);
assert.equal(rows[0].cfType, 'secondary');

// create: in PDNS, absent from CF
rows = computePreviewRows([{ name: 'b.com.', account: 'x' }], [], []);
assert.equal(rows[0].previewState, 'create');
assert.equal(rows[0].syncable, true);

// cf-only: present in CF, not in PDNS
rows = computePreviewRows([], [cf('c.com')], []);
assert.equal(rows[0].previewState, 'cf-only');
assert.equal(rows[0].syncable, false);
assert.equal(rows[0].account, null);

// unknown: in scope, no CF data
rows = computePreviewRows([{ name: 'd.com.', account: 'x' }], null, []);
assert.equal(rows[0].previewState, 'unknown');
assert.equal(rows[0].syncable, true);

// tracked wins; ok/error/stale in-scope syncable, provisioning + out-of-scope orphan not
rows = computePreviewRows(
  [{ name: 'e.com.', account: 'x' }, { name: 'f.com.', account: 'x' }],
  [cf('e.com'), cf('f.com'), cf('g.com')],
  [tracked('e.com.', 'error'), tracked('f.com.', 'provisioning'), tracked('g.com.', 'orphan')],
);
const byName = Object.fromEntries(rows.map((r) => [r.zoneName, r]));
assert.equal(byName['e.com.'].previewState, 'tracked');
assert.equal(byName['e.com.'].syncable, true);
assert.equal(byName['f.com.'].syncable, false);
assert.equal(byName['g.com.'].previewState, 'tracked');
assert.equal(byName['g.com.'].syncable, false);
assert.equal(byName['e.com.'].cfPresent, true);

// case-insensitive + trailing-dot join
rows = computePreviewRows([{ name: 'Example.COM.', account: 'x' }], [cf('example.com')], []);
assert.equal(rows.length, 1);
assert.equal(rows[0].previewState, 'adopt');

console.log('preview.computePreviewRows: ALL PASSED');

(async () => {
  __resetCfCache();
  let calls = 0;
  const fetcher = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return [cf('a.com')]; };

  // coalescing: two concurrent calls → one fetch
  const [r1, r2] = await Promise.all([
    getCachedCfZones('k1', fetcher, { ttlMs: 60000 }),
    getCachedCfZones('k1', fetcher, { ttlMs: 60000 }),
  ]);
  assert.equal(calls, 1, 'coalesced to one fetch');
  assert.equal(r1.stale, false);
  assert.equal(r1.zones?.length, 1);
  assert.deepEqual(r2.zones, r1.zones);

  // TTL hit: no new fetch
  await getCachedCfZones('k1', fetcher, { ttlMs: 60000 });
  assert.equal(calls, 1, 'served from cache within TTL');

  // refresh bypasses TTL
  await getCachedCfZones('k1', fetcher, { ttlMs: 60000, refresh: true });
  assert.equal(calls, 2, 'refresh forces a fetch');

  // stale-on-failure: failing fetch returns last-good with stale:true + error
  const boom = async () => { calls++; throw new Error('cf down'); };
  const res = await getCachedCfZones('k1', boom, { ttlMs: 0 });
  assert.equal(res.stale, true);
  assert.equal(res.zones?.length, 1, 'served last-good zones');
  assert.ok(res.error);

  // failure with no cache → zones null
  __resetCfCache();
  const res2 = await getCachedCfZones('empty', boom, { ttlMs: 0 });
  assert.equal(res2.zones, null);
  assert.ok(res2.error);

  // concurrent failure: both coalesced callers get a result, fetch fires once
  __resetCfCache();
  let failCalls = 0;
  const slowBoom = async () => { failCalls++; await new Promise((r) => setTimeout(r, 10)); throw new Error('cf down'); };
  const [f1, f2] = await Promise.all([
    getCachedCfZones('cf', slowBoom, { ttlMs: 0 }),
    getCachedCfZones('cf', slowBoom, { ttlMs: 0 }),
  ]);
  assert.equal(failCalls, 1, 'concurrent failure coalesced to one fetch');
  assert.equal(f1.zones, null);
  assert.ok(f1.error);
  assert.equal(f2.zones, null);
  assert.ok(f2.error);

  console.log('preview.getCachedCfZones: ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
