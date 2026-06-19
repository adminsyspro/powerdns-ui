import assert from 'node:assert';
import { makeRrsetKey } from '../src/lib/record-fields';

// Must equal the raw format historically stored by the pending-changes store.
assert.equal(makeRrsetKey('www.example.com.', 'A'), 'www.example.com.::A');
assert.equal(makeRrsetKey('example.com.', 'SOA'), 'example.com.::SOA');
console.log('rrset-key: ALL PASSED');
