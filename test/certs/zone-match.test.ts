import assert from 'node:assert';
import Database from 'better-sqlite3';
import { canonName, resolveZoneForFqdn, resolveZonesForSans } from '../../src/lib/certs/zone-match';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE zones (id TEXT, server_url TEXT, name TEXT, kind TEXT, PRIMARY KEY (server_url, id));`);
  const ins = db.prepare(`INSERT INTO zones (id, server_url, name, kind) VALUES (?,?,?, 'Master')`);
  ins.run('z1', 'http://pdns', 'example.com.');
  ins.run('z2', 'http://pdns', 'sub.example.com.');   // more specific
  ins.run('z3', 'http://pdns', 'other.net.');
  return db;
}

assert.equal(canonName('Example.COM'), 'example.com.', 'canon adds dot + lowercases');

const db = makeDb();
// longest-suffix wins: a.sub.example.com. → sub.example.com. (not example.com.)
assert.equal(resolveZoneForFqdn('http://pdns', '_acme-challenge.a.sub.example.com.', db), 'sub.example.com.', 'longest suffix');
assert.equal(resolveZoneForFqdn('http://pdns', '_acme-challenge.www.example.com.', db), 'example.com.', 'apex zone');
assert.equal(resolveZoneForFqdn('http://pdns', '_acme-challenge.nope.org.', db), undefined, 'no zone');
// server_url is normalized
assert.equal(resolveZoneForFqdn('http://PDNS/', '_acme-challenge.www.example.com.', db), 'example.com.', 'normalizes server_url');

const mapped = resolveZonesForSans('http://pdns', ['example.com', '*.example.com', 'sub.example.com'], db);
assert.equal(mapped.length, 3, 'all mapped');
assert.equal(mapped[0].fqdn, '_acme-challenge.example.com.', 'apex challenge fqdn');
assert.equal(mapped[1].zone, 'example.com.', 'wildcard maps to apex zone');
assert.throws(() => resolveZonesForSans('http://pdns', ['nope.org'], db), /no managed zone/i, 'throws for unmanaged');

console.log('certs/zone-match: ALL PASSED');
