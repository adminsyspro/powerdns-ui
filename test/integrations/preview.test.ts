import assert from 'node:assert';
import { computePreviewRows } from '../../src/lib/integrations/preview';
import type { IntegrationZoneRow } from '../../src/lib/integrations/types';
import type { CfZone } from '../../src/lib/integrations/cloudflare';

const cf = (name: string, type = 'secondary'): CfZone =>
  ({ id: 'cf-' + name, name, type, status: 'active' } as CfZone);
const tracked = (zoneName: string, status: IntegrationZoneRow['status']): IntegrationZoneRow =>
  ({ zoneName, remoteZoneId: 'r', remoteType: 'secondary', customNsSet: null, status, message: null, updatedAt: 1 });

// adopt: in PDNS scope + present in CF, untracked
let rows = computePreviewRows([{ name: 'a.com.', account: 'x' }], [cf('a.com')], []);
assert.equal(rows.length, 1);
assert.equal(rows[0].previewState, 'adopt');
assert.equal(rows[0].syncable, true);
assert.equal(rows[0].cfType, 'secondary');

// create: in scope, absent from CF
rows = computePreviewRows([{ name: 'b.com.', account: 'x' }], [], []);
assert.equal(rows[0].previewState, 'create');
assert.equal(rows[0].syncable, true);

// cf-only: present in CF, not in scope
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
