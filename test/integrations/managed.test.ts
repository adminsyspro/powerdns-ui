import assert from 'node:assert';
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.exec(`CREATE TABLE integration_zones (
  integration_id TEXT NOT NULL, server_url TEXT NOT NULL, zone_name TEXT NOT NULL,
  remote_zone_id TEXT, remote_type TEXT, custom_ns_set INTEGER,
  status TEXT NOT NULL, message TEXT, updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (integration_id, server_url, zone_name));`);
db.prepare(`INSERT INTO integration_zones (integration_id,server_url,zone_name,status) VALUES ('i','u','legacy.fr.','ok')`).run();

db.exec(`ALTER TABLE integration_zones ADD COLUMN managed TEXT NOT NULL DEFAULT 'auto'`);
assert.equal(db.prepare(`SELECT managed FROM integration_zones WHERE zone_name='legacy.fr.'`).get().managed, 'auto', 'legacy row backfills auto');

const upsert = db.prepare(`INSERT INTO integration_zones (integration_id,server_url,zone_name,remote_zone_id,remote_type,status,message)
  VALUES (@i,@u,@z,@rid,@rt,@st,@msg)
  ON CONFLICT(integration_id,server_url,zone_name) DO UPDATE SET
    remote_zone_id=excluded.remote_zone_id, remote_type=excluded.remote_type,
    status=excluded.status, message=excluded.message, updated_at=unixepoch()`);
const setManaged = db.prepare(`UPDATE integration_zones SET managed=? WHERE integration_id=? AND server_url=? AND zone_name=?`);

upsert.run({ i:'i', u:'u', z:'manual.fr.', rid:'r', rt:'secondary', st:'provisioning', msg:null });
setManaged.run('manual', 'i', 'u', 'manual.fr.');
assert.equal(db.prepare(`SELECT managed FROM integration_zones WHERE zone_name='manual.fr.'`).get().managed, 'manual');

upsert.run({ i:'i', u:'u', z:'manual.fr.', rid:'r', rt:'secondary', st:'ok', msg:null });
assert.equal(db.prepare(`SELECT managed FROM integration_zones WHERE zone_name='manual.fr.'`).get().managed, 'manual', 'manual preserved across status upsert');

upsert.run({ i:'i', u:'u', z:'legacy.fr.', rid:null, rt:null, st:'orphan', msg:'gone' });
assert.equal(db.prepare(`SELECT managed FROM integration_zones WHERE zone_name='legacy.fr.'`).get().managed, 'auto');

console.log('managed migration + preserve + setter: ALL PASSED');
