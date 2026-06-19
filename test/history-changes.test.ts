import assert from 'node:assert';
import Database from 'better-sqlite3';
import { getChangeCountsForZone, getChangesForRRSet } from '../src/lib/cache/history';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE change_history (
    id TEXT PRIMARY KEY, server_url TEXT NOT NULL, zone_id TEXT NOT NULL,
    zone_name TEXT NOT NULL, changes_json TEXT NOT NULL, reason TEXT DEFAULT '',
    user TEXT DEFAULT 'admin', submitted_at INTEGER NOT NULL, status TEXT NOT NULL,
    error_message TEXT DEFAULT NULL);
  CREATE INDEX idx_change_history_zone ON change_history(server_url, zone_id, submitted_at);`);
  return db;
}
let seq = 0;
function seed(db: Database.Database, keys: string[], opts: { status?: string; user?: string; reason?: string } = {}) {
  seq += 1;
  const changes = keys.map((k) => ({ id: `c${seq}-${k}`, zoneId: 'z.', action: 'EDIT', rrsetKey: k, before: null, after: null, createdAt: seq }));
  db.prepare(`INSERT INTO change_history (id, server_url, zone_id, zone_name, changes_json, reason, user, submitted_at, status)
              VALUES (?, 'http://pdns', 'z.', 'z.', ?, ?, ?, ?, ?)`)
    .run(`cs${seq}`, JSON.stringify(changes), opts.reason ?? '', opts.user ?? 'alice', seq, opts.status ?? 'success');
}

const db = makeDb();
seed(db, ['www.z.::A', 'mail.z.::MX']);         // cs1
seed(db, ['www.z.::A']);                          // cs2
seed(db, ['www.z.::A', 'www.z.::A']);             // cs3 duplicate key in one changeset
seed(db, ['www.z.::A'], { status: 'error' });     // cs4 error — excluded

const counts = getChangeCountsForZone('http://pdns', 'z.', db);
assert.equal(counts['www.z.::A'], 3, 'www counted once per changeset, error excluded');
assert.equal(counts['mail.z.::MX'], 1, 'mail counted once');
assert.equal(counts['absent::A'], undefined, 'absent key not present');

const tl = getChangesForRRSet('http://pdns', 'z.', 'www.z.::A', 100, db);
assert.equal(tl.items.length, 3, 'one entry per changeset (dedup within changeset)');
assert.equal(tl.hasMore, false, 'no more');
assert.equal(tl.items[0].submittedAt > tl.items[1].submittedAt, true, 'newest first');

// > limit
const db2 = makeDb();
for (let i = 0; i < 101; i++) seed(db2, ['big::A']);
const c2 = getChangeCountsForZone('http://pdns', 'z.', db2);
assert.equal(c2['big::A'], 101, 'exact count, no cap');
const tl2 = getChangesForRRSet('http://pdns', 'z.', 'big::A', 100, db2);
assert.equal(tl2.items.length, 100, 'timeline capped at 100');
assert.equal(tl2.hasMore, true, 'hasMore when > limit');

console.log('history-changes: ALL PASSED');
