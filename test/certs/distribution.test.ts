import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { encrypt } from '../../src/lib/crypto';
import { migrateDistribution, FILESYSTEM_DEFAULT_ID, INFISICAL_DEFAULT_ID } from '../../src/lib/certs/distribution/schema';
import {
  normalizePathTemplate, resolvePath, __setInfisicalFetch,
} from '../../src/lib/certs/distribution/providers/infisical-secrets';
import {
  listDistributionsForCertificate, addManualDistribution, ensureAutoDistributions, backoffSeconds,
} from '../../src/lib/certs/distribution/distribution-store';
import { createConnection, updateConnection, getConnection } from '../../src/lib/certs/distribution/connection-store';
import {
  runDistributionCycle, reconcileCertificate, removeAllForCertificate, removeDistribution, removeConnection,
} from '../../src/lib/certs/distribution/reconcile';

delete process.env.CERTS_GID; // legacy (non-shared) materialization in tests
const CERTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-test-'));
process.env.CERTS_DIR = CERTS_DIR;

function makeDb(withInfisical: { base: string; enabled: boolean } | null) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE certificates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, acme_account_id TEXT NOT NULL DEFAULT 'a',
      connection_id TEXT NOT NULL DEFAULT 'c', server_url TEXT NOT NULL DEFAULT 'http://pdns', sans_json TEXT NOT NULL DEFAULT '[]',
      category TEXT DEFAULT NULL, comment TEXT DEFAULT NULL, last_run_log TEXT DEFAULT NULL,
      key_type TEXT NOT NULL DEFAULT 'ecdsa', status TEXT NOT NULL DEFAULT 'pending',
      renewal_status TEXT NOT NULL DEFAULT 'idle', last_renewal_error TEXT DEFAULT NULL,
      error_class TEXT DEFAULT NULL, next_attempt_at INTEGER DEFAULT NULL,
      not_before INTEGER DEFAULT NULL, not_after INTEGER DEFAULT NULL,
      serial TEXT DEFAULT NULL, fingerprint_sha256 TEXT DEFAULT NULL, issuer TEXT DEFAULT NULL,
      cert_pem TEXT DEFAULT NULL, chain_pem TEXT DEFAULT NULL, privkey_enc TEXT DEFAULT NULL,
      key_download_enabled INTEGER NOT NULL DEFAULT 1, auto_renew INTEGER NOT NULL DEFAULT 1,
      renew_before_days INTEGER NOT NULL DEFAULT 30, last_issued_at INTEGER DEFAULT NULL,
      last_renewal_success_at INTEGER DEFAULT NULL, materialized_at INTEGER DEFAULT NULL,
      infisical_synced_at INTEGER DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE certificate_events (
      id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT (unixepoch()),
      type TEXT NOT NULL, status TEXT DEFAULT NULL, actor TEXT DEFAULT NULL, actor_ip TEXT DEFAULT NULL, message TEXT DEFAULT NULL
    );
    CREATE TABLE infisical_config (
      id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0, site_url TEXT NOT NULL DEFAULT '',
      client_id TEXT NOT NULL DEFAULT '', client_secret_enc TEXT NOT NULL DEFAULT '', project_id TEXT NOT NULL DEFAULT '',
      environment TEXT NOT NULL DEFAULT 'production', secret_base_path TEXT NOT NULL DEFAULT '/ssl'
    );`);
  if (withInfisical) {
    db.prepare(`INSERT INTO infisical_config VALUES (1, ?, 'https://vault.test/', 'cid', ?, 'proj-pdns', 'prod', ?)`)
      .run(withInfisical.enabled ? 1 : 0, encrypt('client-secret'), withInfisical.base);
  }
  return db;
}

function insertCert(db: Database.Database, o: {
  id: string; name: string; category?: string | null; fp?: string | null; issuedAt?: number | null;
  materializedAt?: number | null; syncedAt?: number | null;
}) {
  const issued = o.fp !== null;
  db.prepare(
    `INSERT INTO certificates (id, name, category, fingerprint_sha256, cert_pem, chain_pem, privkey_enc,
       last_issued_at, materialized_at, infisical_synced_at, not_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(o.id, o.name, o.category ?? null, issued ? (o.fp ?? 'FP1') : null,
    issued ? `LEAF-${o.id}\n` : null, issued ? 'CHAIN\n' : null, issued ? encrypt(`KEY-${o.id}\n`) : null,
    o.issuedAt ?? null, o.materializedAt ?? null, o.syncedAt ?? null, issued ? 2_000_000_000 : null);
}

function renew(db: Database.Database, id: string, fp: string) {
  db.prepare(`UPDATE certificates SET fingerprint_sha256 = ?, cert_pem = ?, last_issued_at = unixepoch() WHERE id = ?`)
    .run(fp, `LEAF-${id}-${fp}\n`, id);
}

// ---------------------------------------------------------------- fake Infisical
interface Call { method: string; url: string; body: any }
const calls: Call[] = [];
const secrets = new Map<string, string>(); // "<project>|<env>|<path>|<NAME>" → value
const folders = new Set<string>();         // "<project>|<env>|<path>"
let failSecretWrites: string | null = null;
let duplicateStatus = 400; // current Infisical: 400 "Secret already exists"

function fakeInfisical(): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status });
    if (url.endsWith('/api/v1/auth/universal-auth/login')) {
      return body.clientSecret === 'client-secret' ? json(200, { accessToken: 'tok', expiresIn: 3600 }) : json(401, { message: 'bad' });
    }
    if (url.endsWith('/api/v1/folders') && method === 'POST') {
      const key = `${body.workspaceId}|${body.environment}|${body.path === '/' ? '' : body.path}/${body.name}`;
      if (folders.has(key)) return json(400, { message: 'Folder already exists' });
      folders.add(key);
      return json(200, {});
    }
    const m = url.match(/\/api\/v3\/secrets\/raw\/([^?]+)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const key = `${body.workspaceId}|${body.environment}|${body.secretPath}|${name}`;
      if (method === 'POST') {
        if (failSecretWrites) return json(500, { message: failSecretWrites });
        if (secrets.has(key)) return json(duplicateStatus, { message: `Secret '${name}' already exists` });
        secrets.set(key, body.secretValue); return json(200, {});
      }
      if (method === 'PATCH') { secrets.set(key, body.secretValue); return json(200, {}); }
      if (method === 'DELETE') {
        if (!secrets.has(key)) return json(404, { message: 'Secret not found' });
        secrets.delete(key); return json(200, {});
      }
    }
    if (url.includes('/api/v3/secrets/raw?')) return json(200, { secrets: [] });
    return json(404, { message: 'unexpected ' + method + ' ' + url });
  }) as typeof fetch;
}
__setInfisicalFetch(fakeInfisical());

const S = (project: string, p: string, name: string) => secrets.get(`${project}|prod|${p}|${name}`);

// ================================================================ path templates
test('path templates', () => {
assert.equal(normalizePathTemplate(''), '/{category}/{name}', 'default template');
assert.equal(normalizePathTemplate('/{name}/'), '/{name}', 'trailing slash dropped');
assert.throws(() => normalizePathTemplate('ssl'), /start with/, 'relative path refused');
assert.throws(() => normalizePathTemplate('/{foo}'), /placeholder/, 'unknown placeholder refused');
assert.throws(() => normalizePathTemplate('/a b'), /invalid path segment/, 'bad chars refused');
assert.equal(resolvePath('/{category}/{name}', { name: 'proxcenter.api.infra', category: 'DATACENTER' }),
  '/DATACENTER/proxcenter-api-infra', 'historical layout (dots → dashes)');
assert.equal(resolvePath('/ssl/{category}/{name}', { name: 'web', category: null }), '/ssl/_default/web', 'null category → _default');
});

// ================================================================ migration
test('migration of the legacy config + republish of stale copies', async () => {
  const db = makeDb({ base: '/', enabled: true });
  const T0 = 1_780_000_000;
  // fresh on both destinations
  insertCert(db, { id: 'fresh', name: 'fresh.api.infra', category: 'DATACENTER', fp: 'F1', issuedAt: T0, materializedAt: T0, syncedAt: T0 });
  // the proxcenter case: renewed after the last successful Infisical sync
  insertCert(db, { id: 'stale', name: 'proxcenter.api.infra', category: 'DATACENTER', fp: 'S2', issuedAt: T0 + 100, materializedAt: T0 + 100, syncedAt: T0 });
  // never issued
  insertCert(db, { id: 'pending', name: 'pending', fp: null });
  migrateDistribution(db);
  migrateDistribution(db); // idempotent

  const conns = db.prepare('SELECT id, type, enabled, auto_attach, config_json, default_target_json, secret_enc FROM distribution_connections ORDER BY id').all() as any[];
  assert.deepEqual(conns.map((c) => c.id), [FILESYSTEM_DEFAULT_ID, INFISICAL_DEFAULT_ID], 'two default connections');
  const inf = conns.find((c) => c.id === INFISICAL_DEFAULT_ID);
  assert.deepEqual(JSON.parse(inf.config_json), { siteUrl: 'https://vault.test', clientId: 'cid' }, 'site url trailing slash trimmed');
  assert.deepEqual(JSON.parse(inf.default_target_json), { projectId: 'proj-pdns', environment: 'prod', path: '/{category}/{name}' }, 'legacy layout preserved');
  assert.ok(inf.secret_enc, 'client secret carried over (still encrypted)');
  assert.equal(inf.auto_attach, 1);

  const rows = db.prepare('SELECT certificate_id, connection_id, origin, published_fingerprint, published_target_json FROM certificate_distributions').all() as any[];
  assert.equal(rows.length, 6, 'one auto distribution per (cert × default connection)');
  const row = (c: string, k: string) => rows.find((r) => r.certificate_id === c && r.connection_id === k);
  assert.equal(row('fresh', INFISICAL_DEFAULT_ID).published_fingerprint, 'F1', 'fresh Infisical copy not republished');
  assert.deepEqual(JSON.parse(row('fresh', INFISICAL_DEFAULT_ID).published_target_json),
    { projectId: 'proj-pdns', environment: 'prod', path: '/DATACENTER/fresh-api-infra' }, 'legacy location recorded');
  assert.equal(row('stale', INFISICAL_DEFAULT_ID).published_fingerprint, null, 'stale Infisical copy will be republished');
  assert.ok(row('stale', INFISICAL_DEFAULT_ID).published_target_json, 'stale copy location still recorded');
  assert.equal(row('stale', FILESYSTEM_DEFAULT_ID).published_fingerprint, 'S2', 'fresh disk copy kept');
  assert.equal(row('pending', FILESYSTEM_DEFAULT_ID).published_target_json, null, 'never written → nothing recorded');

  // The legacy stale cert gets republished by the first cycle (this is the proxcenter fix).
  secrets.set('proj-pdns|prod|/DATACENTER/proxcenter-api-infra|PRIVKEY', 'OLD'); // exists → POST answers 400
  folders.add('proj-pdns|prod|/DATACENTER'); folders.add('proj-pdns|prod|/DATACENTER/proxcenter-api-infra');
  {
    const s = await runDistributionCycle(db);
    assert.equal(s.failed, 0, `cycle without failure: ${JSON.stringify(s.outcomes)}`);
    assert.equal(S('proj-pdns', '/DATACENTER/proxcenter-api-infra', 'PRIVKEY'), 'KEY-stale\n',
      'REGRESSION: existing secret (400 "already exists") is updated via PATCH');
    assert.equal(S('proj-pdns', '/DATACENTER/proxcenter-api-infra', 'FULLCHAIN'), 'LEAF-stale\n\nCHAIN\n',
      'historical FULLCHAIN format: leaf + "\\n" + chain');
    const again = await runDistributionCycle(db);
    assert.equal(again.published + again.failed, 0, 'second cycle: nothing to do');
  }
});

// ================================================================ reconcile scenarios
async function scenario2() {
  secrets.clear(); folders.clear(); calls.length = 0;
  const db = makeDb({ base: '/ssl', enabled: true });
  insertCert(db, { id: 'c1', name: 'web.api.infra', category: 'WEB', fp: 'A1', issuedAt: 1 });
  migrateDistribution(db);

  // first publish: disk + Infisical
  let s = await reconcileCertificate('c1', {}, db);
  assert.equal(s.published, 2, 'published to disk and Infisical');
  const live = path.join(CERTS_DIR, 'live', 'web.api.infra');
  assert.equal(fs.readFileSync(path.join(live, 'privkey.pem'), 'utf8'), 'KEY-c1\n', 'key on disk');
  assert.equal(fs.readFileSync(path.join(live, 'fullchain.pem'), 'utf8'), 'LEAF-c1\nCHAIN\n', 'historical disk fullchain format');
  assert.equal(S('proj-pdns', '/ssl/WEB/web-api-infra', 'CERT'), 'LEAF-c1\n');
  const certRow = db.prepare('SELECT materialized_at, infisical_synced_at FROM certificates WHERE id = ?').get('c1') as any;
  assert.ok(certRow.materialized_at && certRow.infisical_synced_at, 'legacy timestamps maintained');

  // renewal → republished by the cycle
  renew(db, 'c1', 'A2');
  s = await runDistributionCycle(db);
  assert.equal(s.published, 2, 'renewal republished everywhere');
  assert.equal(S('proj-pdns', '/ssl/WEB/web-api-infra', 'CERT'), 'LEAF-c1-A2\n');

  // failure → backoff, one event per distinct error, retried later
  renew(db, 'c1', 'A3');
  failSecretWrites = 'boom';
  s = await runDistributionCycle(db);
  assert.equal(s.failed, 1, 'Infisical failure reported');
  assert.equal(s.published, 1, 'disk still published');
  const now = Math.floor(Date.now() / 1000);
  s = await runDistributionCycle(db, now);
  assert.equal(s.failed + s.published, 0, 'backoff respected');
  s = await runDistributionCycle(db, now + backoffSeconds(1) + 1);
  assert.equal(s.failed, 1, 'retried after backoff');
  const errEvents = db.prepare(`SELECT COUNT(*) AS n FROM certificate_events WHERE type = 'distribution_error'`).get() as any;
  assert.equal(errEvents.n, 1, 'same error not logged twice');
  failSecretWrites = null;
  s = await runDistributionCycle(db, now + 100_000);
  assert.equal(s.published, 1, 'recovers once Infisical is back');
  const d = listDistributionsForCertificate('c1', db).find((x) => x.connectionId === INFISICAL_DEFAULT_ID)!;
  assert.equal(d.status, 'published');
  assert.equal(d.lastError, null, 'error cleared');
  assert.equal(d.attempts, 0, 'attempts reset');

  // moving the default target: new location written, old one deleted
  updateConnection(INFISICAL_DEFAULT_ID, { defaultTarget: { projectId: 'proj-pdns', environment: 'prod', path: '/certs/{name}' } }, db);
  s = await runDistributionCycle(db);
  assert.equal(s.published, 1, 'moved');
  assert.equal(S('proj-pdns', '/certs/web-api-infra', 'PRIVKEY'), 'KEY-c1\n', 'written at new location');
  assert.equal(S('proj-pdns', '/ssl/WEB/web-api-infra', 'PRIVKEY'), undefined, 'old private key removed');

  // per-consumer project (manual distribution)
  const consumer = addManualDistribution({ certificateId: 'c1', connectionId: INFISICAL_DEFAULT_ID,
    target: { projectId: 'tls-web', environment: 'prod', path: '/{name}' } }, db);
  assert.throws(() => addManualDistribution({ certificateId: 'c1', connectionId: INFISICAL_DEFAULT_ID,
    target: { projectId: 'tls-web', environment: 'prod', path: '/{name}' } }, db), /already distributed/, 'duplicate refused');
  s = await runDistributionCycle(db);
  assert.equal(s.published, 1, 'consumer destination published');
  assert.equal(S('tls-web', '/web-api-infra', 'PRIVKEY'), 'KEY-c1\n');
  await removeDistribution(consumer.id, db);
  assert.equal(S('tls-web', '/web-api-infra', 'PRIVKEY'), undefined, 'removing a destination deletes its secrets');

  // auto distributions cannot be removed one by one
  const auto = listDistributionsForCertificate('c1', db).find((x) => x.origin === 'auto')!;
  await assert.rejects(() => removeDistribution(auto.id, db), /every certificate/, 'auto distribution protected');

  // disabled connection is skipped
  updateConnection(INFISICAL_DEFAULT_ID, { enabled: false }, db);
  renew(db, 'c1', 'A4');
  s = await runDistributionCycle(db);
  assert.equal(s.published, 1, 'only disk while Infisical is disabled');
  assert.equal(listDistributionsForCertificate('c1', db).find((x) => x.connectionId === INFISICAL_DEFAULT_ID)!.status, 'disabled');
  updateConnection(INFISICAL_DEFAULT_ID, { enabled: true }, db);

  // a new auto-attach connection reaches existing certificates
  const extra = createConnection({ name: 'NFS export', type: 'filesystem', config: { dir: path.join(CERTS_DIR, 'nfs') },
    autoAttach: true, defaultTarget: {} }, db);
  assert.equal(ensureAutoDistributions(db), 1, 'auto distribution created for the existing cert');
  s = await runDistributionCycle(db);
  assert.ok(fs.existsSync(path.join(CERTS_DIR, 'nfs', 'live', 'web.api.infra', 'privkey.pem')), 'second disk destination written');
  await removeConnection(extra.id, db);
  assert.ok(!fs.existsSync(path.join(CERTS_DIR, 'nfs', 'live', 'web.api.infra')), 'deleting a connection unpublishes first');
  assert.equal(getConnection(extra.id, db), undefined);
  await assert.rejects(() => removeConnection(FILESYSTEM_DEFAULT_ID, db), /cannot be deleted/, 'local disk protected');
  assert.ok(fs.existsSync(live), '…and nothing was unpublished by the refused delete');

  // certificate deletion unpublishes everywhere
  const errors = await removeAllForCertificate('c1', db);
  assert.deepEqual(errors, []);
  assert.ok(!fs.existsSync(live), 'disk copy removed');
  assert.equal(S('proj-pdns', '/certs/web-api-infra', 'PRIVKEY'), undefined, 'Infisical copy removed');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM certificate_distributions').get() as any).n, 0, 'rows removed');

  // 409 (older Infisical) is also treated as "exists"
  duplicateStatus = 409;
  insertCert(db, { id: 'c2', name: 'old', fp: 'B1', issuedAt: 1 });
  secrets.set('proj-pdns|prod|/certs/old|PRIVKEY', 'X');
  s = await reconcileCertificate('c2', {}, db);
  assert.equal(s.failed, 0, '409 handled');
  assert.equal(S('proj-pdns', '/certs/old', 'PRIVKEY'), 'KEY-c2\n');

  // secrets never leave through the public connection shape
  assert.ok(!JSON.stringify(getConnection(INFISICAL_DEFAULT_ID, db)).includes('client-secret'), 'no secret in public shape');

  fs.rmSync(CERTS_DIR, { recursive: true, force: true });
}

test('reconcile: publish, renew, retry, move, remove', scenario2);
