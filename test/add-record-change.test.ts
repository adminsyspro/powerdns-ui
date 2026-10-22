import assert from 'node:assert';
import { buildAddRecordChange, changesToRRSets } from '../src/lib/pending-changes-utils';
import type { PendingChange, RRSet } from '../src/types/powerdns';

const mx = (...values: string[]): RRSet => ({
  name: 'example.com.', type: 'MX', ttl: 3600,
  records: values.map((content) => ({ content, disabled: false })),
});
const server = mx('10 mx1.old.net.', '20 mx2.old.net.');
const pending = (p: Partial<PendingChange>): PendingChange => ({
  id: 'c1', zoneId: 'example.com.', rrsetKey: 'example.com.::MX', createdAt: 0,
  action: 'EDIT', before: server, after: null, ...p,
});

// No pending change, no server RRSet → plain ADD.
assert.deepEqual(buildAddRecordChange(undefined, undefined, mx('10 a.')),
  { action: 'ADD', before: null, after: mx('10 a.') });

// No pending change → value appended to the server RRSet.
assert.deepEqual(buildAddRecordChange(undefined, server, mx('30 mx3.')).after.records.map((r) => r.content),
  ['10 mx1.old.net.', '20 mx2.old.net.', '30 mx3.']);

// Pending partial delete (EDIT) → value appended to the pending state.
const partial = pending({ action: 'EDIT', after: mx('20 mx2.old.net.') });
assert.deepEqual(buildAddRecordChange(partial, server, mx('10 mx1.new.net.')).after.records.map((r) => r.content),
  ['20 mx2.old.net.', '10 mx1.new.net.']);

// BUG: whole MX RRSet deleted (pending DELETE, after = null), then a new MX
// added → only the new value must be sent, never the deleted server values.
const deleted = pending({ action: 'DELETE', after: null });
const change = buildAddRecordChange(deleted, server, mx('10 mx1.new.net.'));
assert.deepEqual(change.after.records.map((r) => r.content), ['10 mx1.new.net.']);
assert.equal(change.action, 'EDIT');   // not ADD: deleting the new value again must keep the old ones deleted
assert.deepEqual(change.before, server);
const [patch] = changesToRRSets([{ ...deleted, action: change.action, after: change.after }]);
assert.equal(patch.changetype, 'REPLACE');
assert.deepEqual(patch.records.map((r) => r.content), ['10 mx1.new.net.']);

console.log('buildAddRecordChange: ALL PASSED');
