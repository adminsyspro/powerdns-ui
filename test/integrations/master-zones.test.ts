import assert from 'node:assert';
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.exec(`CREATE TABLE zones (id TEXT, server_url TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, account TEXT DEFAULT '', PRIMARY KEY (server_url, id));`);
const ins = db.prepare("INSERT INTO zones (id,server_url,name,kind,account) VALUES (?, 'u', ?, ?, ?)");
ins.run('1','a.com.','Master','g1'); ins.run('2','b.com.','Native','g1');
ins.run('3','c.com.','Slave','g1'); ins.run('4','1.10.in-addr.arpa.','Master','g1');
ins.run('5','d.com.','Master','');

const rows = db.prepare(`SELECT name, account FROM zones
   WHERE server_url = ? AND kind = 'Master'
     AND NOT (name='in-addr.arpa.' OR name LIKE '%.in-addr.arpa.' OR name='ip6.arpa.' OR name LIKE '%.ip6.arpa.')
   ORDER BY name`).all('u');
assert.deepEqual(rows.map((r: any) => r.name), ['a.com.','d.com.'], 'only non-reverse Master');
console.log('listMasterZones SQL: ALL PASSED');
