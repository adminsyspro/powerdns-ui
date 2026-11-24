import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { encrypt, decryptStrict } from '@/lib/crypto';
import { getProvider } from './registry';
import { FILESYSTEM_DEFAULT_ID } from './schema';
import type { DistributionConnection, ProviderContext, ProviderType, TargetSpec } from './types';

type Db = Database.Database;

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToConnection(r: any): DistributionConnection {
  return {
    id: r.id,
    name: r.name,
    type: r.type as ProviderType,
    enabled: r.enabled === 1,
    config: parseJson(r.config_json, {}),
    hasSecret: !!r.secret_enc,
    autoAttach: r.auto_attach === 1,
    defaultTarget: parseJson<TargetSpec | null>(r.default_target_json, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Never select secret_enc into the public shape — presence only.
const COLS = `id, name, type, enabled, config_json, (secret_enc <> '') AS secret_enc, auto_attach,
              default_target_json, created_at, updated_at`;

export function listConnections(db: Db = getDb()): DistributionConnection[] {
  return db.prepare(`SELECT ${COLS} FROM distribution_connections ORDER BY created_at, name`).all().map(rowToConnection);
}

export function getConnection(id: string, db: Db = getDb()): DistributionConnection | undefined {
  const r = db.prepare(`SELECT ${COLS} FROM distribution_connections WHERE id = ?`).get(id);
  return r ? rowToConnection(r) : undefined;
}

/** Build the provider context (decrypts the secret). Server-side only. */
export function providerContext(conn: DistributionConnection, db: Db = getDb()): ProviderContext {
  const row = db.prepare('SELECT secret_enc FROM distribution_connections WHERE id = ?').get(conn.id) as
    | { secret_enc: string }
    | undefined;
  return {
    connectionId: conn.id,
    connectionVersion: conn.updatedAt,
    config: conn.config,
    secret: row?.secret_enc ? decryptStrict(row.secret_enc) : null,
  };
}

export interface ConnectionInput {
  name: string;
  type: string;
  enabled?: boolean;
  config: unknown;
  /** Plaintext; omitted/empty on update = keep the stored one. */
  secret?: string;
  autoAttach?: boolean;
  defaultTarget?: unknown;
}

function validateName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > 64) throw new Error('name is required (max 64 chars)');
  return n;
}

export function createConnection(input: ConnectionInput, db: Db = getDb()): DistributionConnection {
  const provider = getProvider(input.type);
  const name = validateName(input.name);
  const config = provider.normalizeConfig(input.config);
  const autoAttach = !!input.autoAttach;
  const defaultTarget = autoAttach ? provider.normalizeTarget(input.defaultTarget) : null;
  if (provider.needsSecret && !input.secret) throw new Error('secret is required');
  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO distribution_connections (id, name, type, enabled, config_json, secret_enc, auto_attach, default_target_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, provider.type, input.enabled === false ? 0 : 1, JSON.stringify(config),
      input.secret ? encrypt(input.secret) : '', autoAttach ? 1 : 0, defaultTarget ? JSON.stringify(defaultTarget) : null);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) throw new Error(`a connection named "${name}" already exists`);
    throw e;
  }
  return getConnection(id, db)!;
}

export function updateConnection(
  id: string,
  patch: Partial<Omit<ConnectionInput, 'type'>>,
  db: Db = getDb(),
): DistributionConnection {
  const cur = getConnection(id, db);
  if (!cur) throw new Error('connection not found');
  const provider = getProvider(cur.type);
  const name = patch.name !== undefined ? validateName(patch.name) : cur.name;
  const config = patch.config !== undefined ? provider.normalizeConfig(patch.config) : cur.config;
  const autoAttach = patch.autoAttach !== undefined ? !!patch.autoAttach : cur.autoAttach;
  let defaultTarget = cur.defaultTarget;
  if (patch.defaultTarget !== undefined) defaultTarget = provider.normalizeTarget(patch.defaultTarget);
  if (autoAttach && !defaultTarget) defaultTarget = provider.normalizeTarget({});
  const enabled = patch.enabled !== undefined ? !!patch.enabled : cur.enabled;

  // updated_at must strictly increase: providers key their auth cache on it.
  const now = Math.max(Math.floor(Date.now() / 1000), cur.updatedAt + 1);
  try {
    db.prepare(
      `UPDATE distribution_connections
          SET name = ?, enabled = ?, config_json = ?, auto_attach = ?, default_target_json = ?, updated_at = ?
              ${patch.secret ? ', secret_enc = ?' : ''}
        WHERE id = ?`,
    ).run(...([name, enabled ? 1 : 0, JSON.stringify(config), autoAttach ? 1 : 0,
      defaultTarget ? JSON.stringify(defaultTarget) : null, now] as unknown[]),
      ...(patch.secret ? [encrypt(patch.secret)] : []), id);
  } catch (e) {
    if (/UNIQUE/.test((e as Error).message)) throw new Error(`a connection named "${name}" already exists`);
    throw e;
  }
  if (cur.autoAttach && !autoAttach) {
    // Auto distributions that never published anything can simply go; published
    // ones are kept (as manual, same target) so nothing is left orphaned silently.
    db.prepare(`DELETE FROM certificate_distributions WHERE connection_id = ? AND origin = 'auto' AND published_target_json IS NULL`).run(id);
    db.prepare(
      `UPDATE certificate_distributions SET origin = 'manual', target_json = ? WHERE connection_id = ? AND origin = 'auto'`,
    ).run(JSON.stringify(cur.defaultTarget ?? {}), id);
  }
  return getConnection(id, db)!;
}

export function countDistributionsForConnection(id: string, db: Db = getDb()): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM certificate_distributions WHERE connection_id = ?').get(id) as { n: number }).n;
}

/** Delete a connection that no longer has any distribution (callers remove/unpublish those first). */
export function deleteConnection(id: string, db: Db = getDb()): void {
  if (id === FILESYSTEM_DEFAULT_ID) throw new Error('the local disk connection cannot be deleted (disable it instead)');
  if (countDistributionsForConnection(id, db) > 0) {
    throw new Error('connection still has distributions; remove them first');
  }
  db.prepare('DELETE FROM distribution_connections WHERE id = ?').run(id);
}
