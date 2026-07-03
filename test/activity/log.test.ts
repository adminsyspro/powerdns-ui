import assert from 'node:assert';
import Database from 'better-sqlite3';
import { logActivity, listActivity } from '../../src/lib/activity/log';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE activity_log (
      id            TEXT PRIMARY KEY,
      ts            INTEGER NOT NULL DEFAULT (unixepoch()),
      actor_id      TEXT,
      actor_name    TEXT NOT NULL,
      actor_ip      TEXT,
      action        TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id   TEXT,
      resource_name TEXT,
      details       TEXT
    );
    CREATE INDEX idx_activity_ts ON activity_log(ts DESC);
    CREATE INDEX idx_activity_action ON activity_log(action);
    CREATE INDEX idx_activity_resource ON activity_log(resource_type);
    CREATE INDEX idx_activity_actor ON activity_log(actor_id);
  `);
  return db;
}

const db = makeDb();

// logActivity: basic insert
logActivity({ actorId: 'u1', actorName: 'alice', actorIp: '1.2.3.4', action: 'create', resourceType: 'certificate', resourceId: 'c1', resourceName: 'example.com', details: 'a.example.com, b.example.com' }, db);
logActivity({ actorId: 'u1', actorName: 'alice', actorIp: '1.2.3.4', action: 'delete', resourceType: 'certificate', resourceId: 'c1', resourceName: 'example.com' }, db);
logActivity({ actorId: null, actorName: 'bob', actorIp: '5.6.7.8', action: 'login_failed', resourceType: 'session', resourceName: 'bob' }, db);

// logActivity never throws even against a broken db handle
const brokenDb = { prepare: () => { throw new Error('boom'); } } as unknown as Database.Database;
assert.doesNotThrow(() => logActivity({ actorName: 'system', action: 'login', resourceType: 'session' }, brokenDb), 'logActivity must be best-effort');

// listActivity: basic fetch returns all rows, newest first
const all = listActivity({}, db);
assert.equal(all.total, 3, 'three rows total');
assert.equal(all.items.length, 3, 'all rows returned within page size');
assert.equal(all.items[0].actorName, 'bob', 'newest first (login_failed inserted last)');

// filter by action
const deletes = listActivity({ action: 'delete' }, db);
assert.equal(deletes.total, 1, 'one delete row');
assert.equal(deletes.items[0].resourceName, 'example.com', 'delete row is the cert delete');

// filter by resourceType
const sessions = listActivity({ resourceType: 'session' }, db);
assert.equal(sessions.total, 1, 'one session row');

// filter by actor
const aliceRows = listActivity({ actor: 'alice' }, db);
assert.equal(aliceRows.total, 2, 'alice has two rows');

// search across resourceName/details/actorName
const searchByResource = listActivity({ search: 'example.com' }, db);
assert.equal(searchByResource.total, 2, 'search matches both cert rows by resourceName');
const searchByActor = listActivity({ search: 'bob' }, db);
assert.equal(searchByActor.total, 1, 'search matches actor_name');

// pagination: pageSize 2 over 3 rows -> 2 pages
const page1 = listActivity({ page: 1, pageSize: 2 }, db);
assert.equal(page1.items.length, 2, 'page 1 has 2 items');
assert.equal(page1.totalPages, 2, 'two total pages');
const page2 = listActivity({ page: 2, pageSize: 2 }, db);
assert.equal(page2.items.length, 1, 'page 2 has the remaining item');

console.log('activity/log: ALL PASSED');
