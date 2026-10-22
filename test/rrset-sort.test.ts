import assert from 'node:assert';
import { compareRrsets } from '../src/lib/record-fields';

const rrsets = [
  { name: 'www.example.com.', type: 'CNAME' },
  { name: 'example.com.', type: 'SOA' },
  { name: 'mail.example.com.', type: 'A' },
  { name: 'example.com.', type: 'TXT' },
  { name: 'example.com.', type: 'A' },
  { name: 'example.com.', type: 'NS' },
  { name: 'example.com.', type: 'HTTPS' },   // unknown type → last
  { name: 'example.com.', type: 'MX' },
  { name: 'example.com.', type: 'AAAA' },
];
const order = [...rrsets].sort(compareRrsets).map((r) => `${r.type} ${r.name}`);
assert.deepEqual(order, [
  'A example.com.',
  'A mail.example.com.',
  'AAAA example.com.',
  'CNAME www.example.com.',
  'MX example.com.',
  'TXT example.com.',
  'NS example.com.',
  'SOA example.com.',
  'HTTPS example.com.',
]);
console.log('rrset-sort: ALL PASSED');

import { sortZoneExport } from '../src/lib/record-fields';
const exported = [
  'www.example.com.\t3600\tIN\tCNAME\texample.com.',
  'example.com.\t3600\tIN\tNS\tns1.example.net.',
  'example.com.\t3600\tIN\tA\t192.0.2.2',
  'example.com.\t3600\tIN\tSOA\tns1.example.net. hostmaster.example.com. 1 10800 3600 604800 3600',
  'example.com.\t3600\tIN\tA\t192.0.2.1',
  'example.com.\t3600\tIN\tTXT\t"v=spf1 -all"',
  'example.com.\t3600\tIN\tNS\tns2.example.net.',
  '',
].join('\n');
assert.equal(sortZoneExport(exported), [
  'example.com.\t3600\tIN\tSOA\tns1.example.net. hostmaster.example.com. 1 10800 3600 604800 3600',
  'example.com.\t3600\tIN\tA\t192.0.2.2',   // same rrset: original order kept
  'example.com.\t3600\tIN\tA\t192.0.2.1',
  'www.example.com.\t3600\tIN\tCNAME\texample.com.',
  'example.com.\t3600\tIN\tTXT\t"v=spf1 -all"',
  'example.com.\t3600\tIN\tNS\tns1.example.net.',
  'example.com.\t3600\tIN\tNS\tns2.example.net.',
  '',
].join('\n'));
console.log('sortZoneExport: ALL PASSED');
