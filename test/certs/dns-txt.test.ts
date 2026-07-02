import assert from 'node:assert';
import {
  quoteTxt, mergeTxtValues, removeTxtValues, challengeFqdn, buildTxtRrset, buildTxtDelete,
} from '../../src/lib/certs/dns-txt';

assert.equal(quoteTxt('abc'), '"abc"', 'wraps');
assert.equal(quoteTxt('"abc"'), '"abc"', 'idempotent when already quoted');

// apex + wildcard produce two values at the SAME name → both must be kept
assert.deepEqual(
  mergeTxtValues(['"other"'], ['valA', 'valB']),
  ['"other"', '"valA"', '"valB"'],
  'union keeps existing third-party value + adds ours, all quoted'
);
assert.deepEqual(mergeTxtValues(['"dup"'], ['dup']), ['"dup"'], 'dedupe by unquoted value');

// cleanup removes only our values, keeps the rest
assert.deepEqual(removeTxtValues(['"other"', '"valA"', '"valB"'], ['valA', 'valB']), ['"other"'], 'removes only ours');
assert.deepEqual(removeTxtValues(['"valA"'], ['valA']), [], 'empties when we were sole owner');

// challenge fqdn: apex and wildcard both target _acme-challenge.<base>.
assert.equal(challengeFqdn('example.com'), '_acme-challenge.example.com.', 'apex');
assert.equal(challengeFqdn('*.example.com'), '_acme-challenge.example.com.', 'wildcard strips *.');
assert.equal(challengeFqdn('SUB.Example.com.'), '_acme-challenge.sub.example.com.', 'lowercased + canonical');

const rr = buildTxtRrset('_acme-challenge.example.com.', ['"v1"', '"v2"'], 60);
assert.equal(rr.type, 'TXT'); assert.equal(rr.changetype, 'REPLACE'); assert.equal(rr.ttl, 60);
assert.equal(rr.name, '_acme-challenge.example.com.');
assert.deepEqual(rr.records.map((r) => r.content), ['"v1"', '"v2"'], 'records carry quoted content');

const del = buildTxtDelete('_acme-challenge.example.com.');
assert.equal(del.changetype, 'DELETE'); assert.deepEqual(del.records, []);

console.log('certs/dns-txt: ALL PASSED');
