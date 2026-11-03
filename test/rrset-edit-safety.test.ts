import assert from 'node:assert/strict';
import { buildEditRecordChange, findStaleChanges } from '../src/lib/pending-changes-utils.ts';
import type { PendingChange, RRSet } from '../src/types/powerdns.ts';

const rr = (values: string[]): RRSet => ({ name: 'example.com.', type: 'TXT', ttl: 300, records: values.map(content => ({ content, disabled: false })) });
const full = rr(['"v=spf1 -all"', '"canva=old"']);
const edit = buildEditRecordChange(full, '"canva=old"', rr(['"canva=new"']));
assert.deepEqual(edit.records.map(r => r.content), ['"v=spf1 -all"', '"canva=new"']);
const change: PendingChange = { id: '1', zoneId: 'example.com.', rrsetKey: 'example.com.::TXT', action: 'EDIT', before: full, after: edit, createdAt: 0 };
assert.deepEqual(findStaleChanges([change], [rr(['"canva=old"', '"v=spf1 -all"'])]), []);
assert.equal(findStaleChanges([change], [rr(['"v=spf1 -all"', '"canva=old"', '"other"'])]).length, 1);
assert.equal(findStaleChanges([{ ...change, before: rr(['"canva=old"']) }], [full]).length, 1);
console.log('RRset edit safety: ALL PASSED');
