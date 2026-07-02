import assert from 'node:assert';
import Database from 'better-sqlite3';
import { appendCertEvent, listCertEvents } from '../../src/lib/certs/event-store';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE certificate_events (
    id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()),
    type TEXT NOT NULL, status TEXT DEFAULT NULL, actor TEXT DEFAULT NULL,
    actor_ip TEXT DEFAULT NULL, message TEXT DEFAULT NULL
  );`);
  return db;
}
const db = makeDb();
appendCertEvent({ certificateId: 'c1', type: 'issue', status: 'ok', actor: 'admin', actorIp: '1.2.3.4', message: 'issued' }, db);
appendCertEvent({ certificateId: 'c1', type: 'error', message: 'boom' }, db);
appendCertEvent({ certificateId: 'c2', type: 'issue' }, db);
const evs = listCertEvents('c1', 10, db);
assert.equal(evs.length, 2, 'two events for c1');
assert.equal(evs[0].type, 'error', 'newest first');
assert.equal(evs[1].actor, 'admin', 'fields preserved');
console.log('certs/event-store: ALL PASSED');
