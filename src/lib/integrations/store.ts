import { randomUUID } from 'crypto';
import { getDb } from '@/lib/cache/db';
import { encrypt, decrypt } from '@/lib/crypto';
import type {
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationProvider,
  IntegrationRow,
  IntegrationZoneRow,
  IntegrationZoneStatus,
} from './types';

const DEFAULT_CONFIG: IntegrationConfig = {
  mode: 'axfr',
  accountId: '',
  primaryIp: '',
  primaryPort: 53,
  scope: 'all-master',
  groups: [],
  autoProvision: true,
  deleteMode: 'never',
};

// Builds a safe config from untrusted client input. peerId/tsigId are
// provider-managed and never accepted from the client.
export function sanitizeConfig(input: Partial<IntegrationConfig> | undefined): IntegrationConfig {
  const config = input ?? {};
  return {
    mode: config.mode === 'push' ? 'push' : 'axfr',
    accountId: String(config.accountId ?? '').trim(),
    primaryIp: String(config.primaryIp ?? '').trim(),
    primaryPort: Number.isInteger(config.primaryPort) && (config.primaryPort as number) > 0
      ? (config.primaryPort as number)
      : 53,
    tsigName: config.tsigName ? String(config.tsigName).trim() : undefined,
    tsigAlgo: config.tsigAlgo ? String(config.tsigAlgo).trim() : undefined,
    scope: config.scope === 'groups' ? 'groups' : 'all-master',
    groups: Array.isArray(config.groups) ? config.groups.map(String) : [],
    autoProvision: config.autoProvision !== false,
    deleteMode: config.deleteMode === 'delete' ? 'delete' : 'never',
  };
}

function parseConfig(value: string): IntegrationConfig {
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(value) as Partial<IntegrationConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function rowToIntegration(row: {
  id: string; provider: string; name: string; config: string;
  active: number; created_at: number; updated_at: number;
}): IntegrationRow {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    name: row.name,
    config: parseConfig(row.config),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listIntegrations(): IntegrationRow[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, provider, name, config, active, created_at, updated_at FROM integrations ORDER BY name')
    .all() as Parameters<typeof rowToIntegration>[0][];
  return rows.map(rowToIntegration);
}

export function getIntegration(id: string): IntegrationRow | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT id, provider, name, config, active, created_at, updated_at FROM integrations WHERE id = ?')
    .get(id) as Parameters<typeof rowToIntegration>[0] | undefined;
  return row ? rowToIntegration(row) : undefined;
}

export function getIntegrationCredentials(id: string): IntegrationCredentials | undefined {
  const db = getDb();
  const row = db.prepare('SELECT credentials FROM integrations WHERE id = ?').get(id) as
    | { credentials: string }
    | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(decrypt(row.credentials)) as IntegrationCredentials;
  } catch {
    return undefined;
  }
}

export function createIntegration(input: {
  provider: IntegrationProvider;
  name: string;
  config: IntegrationConfig;
  credentials: IntegrationCredentials;
}): IntegrationRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO integrations (id, provider, name, credentials, config) VALUES (?, ?, ?, ?, ?)'
  ).run(id, input.provider, input.name, encrypt(JSON.stringify(input.credentials)), JSON.stringify(input.config));
  return getIntegration(id)!;
}

export function updateIntegration(
  id: string,
  patch: {
    name?: string;
    config?: IntegrationConfig;
    active?: boolean;
    // Only re-encrypted when explicitly provided, so editing settings never
    // requires re-entering the token.
    credentials?: IntegrationCredentials;
  }
): IntegrationRow | undefined {
  const existing = getIntegration(id);
  if (!existing) return undefined;
  const db = getDb();
  db.prepare(
    `UPDATE integrations
        SET name = ?, config = ?, active = ?, updated_at = unixepoch()
      WHERE id = ?`
  ).run(
    patch.name ?? existing.name,
    JSON.stringify(patch.config ?? existing.config),
    (patch.active ?? existing.active) ? 1 : 0,
    id
  );
  if (patch.credentials) {
    db.prepare('UPDATE integrations SET credentials = ? WHERE id = ?').run(
      encrypt(JSON.stringify(patch.credentials)),
      id
    );
  }
  return getIntegration(id);
}

export function deleteIntegration(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM integrations WHERE id = ?').run(id);
}

// ---- Per-zone replication state (scoped by PowerDNS server) ----
// serverUrl must already be normalized (see cache/zones normalizeUrl).

export function listIntegrationZones(integrationId: string, serverUrl: string): IntegrationZoneRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT integration_id, server_url, zone_name, remote_zone_id, status, message, updated_at
         FROM integration_zones WHERE integration_id = ? AND server_url = ? ORDER BY zone_name`
    )
    .all(integrationId, serverUrl) as Array<{
      integration_id: string; server_url: string; zone_name: string; remote_zone_id: string | null;
      status: IntegrationZoneStatus; message: string | null; updated_at: number;
    }>;
  return rows.map((row) => ({
    integrationId: row.integration_id,
    serverUrl: row.server_url,
    zoneName: row.zone_name,
    remoteZoneId: row.remote_zone_id,
    status: row.status,
    message: row.message,
    updatedAt: row.updated_at,
  }));
}

export function upsertIntegrationZone(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
  state: { remoteZoneId?: string | null; status: IntegrationZoneStatus; message?: string | null }
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO integration_zones (integration_id, server_url, zone_name, remote_zone_id, status, message, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(integration_id, server_url, zone_name) DO UPDATE SET
       remote_zone_id = excluded.remote_zone_id,
       status = excluded.status,
       message = excluded.message,
       updated_at = excluded.updated_at`
  ).run(integrationId, serverUrl, zoneName, state.remoteZoneId ?? null, state.status, state.message ?? null);
}

export function getIntegrationZone(
  integrationId: string,
  serverUrl: string,
  zoneName: string
): IntegrationZoneRow | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT integration_id, server_url, zone_name, remote_zone_id, status, message, updated_at
         FROM integration_zones
        WHERE integration_id = ? AND server_url = ? AND zone_name = ?`
    )
    .get(integrationId, serverUrl, zoneName) as
      | {
          integration_id: string; server_url: string; zone_name: string; remote_zone_id: string | null;
          status: IntegrationZoneStatus; message: string | null; updated_at: number;
        }
      | undefined;
  if (!row) return undefined;
  return {
    integrationId: row.integration_id,
    serverUrl: row.server_url,
    zoneName: row.zone_name,
    remoteZoneId: row.remote_zone_id,
    status: row.status,
    message: row.message,
    updatedAt: row.updated_at,
  };
}

/**
 * Flags every healthy link of an integration (all servers — the peer is an
 * account-level object) so the next sync relinks them after peer/TSIG
 * settings changed.
 */
export function markZonesForReprovision(integrationId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE integration_zones
        SET status = 'stale',
            message = 'Peer settings changed — run a sync to relink',
            updated_at = unixepoch()
      WHERE integration_id = ? AND status != 'orphan'`
  ).run(integrationId);
}

export function deleteIntegrationZone(integrationId: string, serverUrl: string, zoneName: string): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM integration_zones WHERE integration_id = ? AND server_url = ? AND zone_name = ?'
  ).run(integrationId, serverUrl, zoneName);
}
