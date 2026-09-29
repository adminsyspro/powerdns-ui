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
assert.equal(rows[0].cfPlan, null, 'plan omitted from the CF listing → null');

// cfPlan comes from the cached CF zone's plan.legacy_id (lower-cased)
rows = computePreviewRows([{ name: 'a.com.', account: 'x' }], [{ ...cf('a.com'), plan: { id: '0f', legacy_id: 'Free' } }], []);
assert.equal(rows[0].cfPlan, 'free');

// create: in PDNS, absent from CF
rows = computePreviewRows([{ name: 'b.com.', account: 'x' }], [], []);
assert.equal(rows[0].previewState, 'create');
assert.equal(rows[0].cfPlan, null, 'no CF zone → no plan');
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

  // waitMs on a cold cache: returns early with pending, listing lands in the background
  __resetCfCache();
  let slowCalls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const slow = async () => { slowCalls++; await gate; return [cf('big.com')]; };
  const w1 = await getCachedCfZones('big', slow, { ttlMs: 60000, waitMs: 5 });
  assert.equal(w1.pending, true, 'cold + slow → pending');
  assert.equal(w1.zones, null);
  assert.equal(w1.error, null);
  const w2 = await getCachedCfZones('big', slow, { ttlMs: 60000, waitMs: 5 });
  assert.equal(w2.pending, true);
  assert.equal(slowCalls, 1, 'background listing is joined, not restarted');
  release();
  await new Promise((r) => setTimeout(r, 5));
  const w3 = await getCachedCfZones('big', slow, { ttlMs: 60000, waitMs: 5 });
  assert.equal(w3.pending, false);
  assert.equal(w3.stale, false);
  assert.equal(w3.zones?.length, 1, 'background result cached');

  // stale-while-revalidate: expired entry is served immediately, refetch in background
  let swrCalls = 0;
  const never = async () => { swrCalls++; return new Promise<ReturnType<typeof cf>[]>(() => {}); };
  const s1 = await getCachedCfZones('big', never, { ttlMs: 0, waitMs: 60000 });
  assert.equal(s1.stale, true);
  assert.equal(s1.pending, true);
  assert.equal(s1.zones?.length, 1, 'served last-good zones without waiting');
  assert.equal(swrCalls, 1);

  // background failure after timeout: no unhandled rejection, error surfaces next call
  __resetCfCache();
  let failRelease: () => void = () => {};
  const failGate = new Promise<void>((r) => { failRelease = r; });
  const lateBoom = async () => { await failGate; throw new Error('cf down late'); };
  const b1 = await getCachedCfZones('late', lateBoom, { ttlMs: 60000, waitMs: 5 });
  assert.equal(b1.pending, true);
  failRelease();
  await new Promise((r) => setTimeout(r, 5));
  const b2 = await getCachedCfZones('late', boom, { ttlMs: 60000, waitMs: 50 });
  assert.equal(b2.zones, null);
  assert.ok(b2.error);
  assert.equal(b2.pending, false);

  console.log('preview.getCachedCfZones: ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
