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
  zones: [],
  customNsMode: 'ignore',
  customNsSet: 1,
  autoProvision: true,
  secondaryOverride: false,
  deleteMode: 'never',
  orphanRetentionHours: 72,
};

// Zone names are stored canonical (trailing dot), matching the zones cache.
function canonZoneName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

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
    scope: config.scope === 'groups' ? 'groups' : config.scope === 'zones' ? 'zones' : 'all-master',
    groups: Array.isArray(config.groups) ? config.groups.map(String) : [],
    zones: Array.isArray(config.zones)
      ? Array.from(new Set(config.zones.map((z) => canonZoneName(String(z))).filter(Boolean)))
      : [],
    customNsMode: config.customNsMode === 'enable' || config.customNsMode === 'disable'
      ? config.customNsMode
      : 'ignore',
    customNsSet: Number.isInteger(config.customNsSet) && (config.customNsSet as number) > 0
      ? (config.customNsSet as number)
      : 1,
    autoProvision: config.autoProvision !== false,
    secondaryOverride: config.secondaryOverride === true,
    deleteMode:
      config.deleteMode === 'auto' ? 'auto'
      : config.deleteMode === 'manual' || (config.deleteMode as string) === 'delete' ? 'manual'
      : 'never',
    orphanRetentionHours:
      Number.isInteger(config.orphanRetentionHours) && (config.orphanRetentionHours as number) >= 1
        ? (config.orphanRetentionHours as number)
        : 72,
  };
}

function parseConfig(value: string): IntegrationConfig {
  try {
    const parsed = { ...DEFAULT_CONFIG, ...(JSON.parse(value) as Partial<IntegrationConfig>) };
    // Legacy migration: the old two-state 'delete' becomes 'manual' (never auto).
    if ((parsed.deleteMode as string) === 'delete') parsed.deleteMode = 'manual';
    return parsed;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function rowToIntegration(row: {
  id: string; provider: string; name: string; connection_id: string | null; config: string;
  active: number; created_at: number; updated_at: number;
}): IntegrationRow {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    name: row.name,
    connectionId: row.connection_id,
    config: parseConfig(row.config),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listIntegrations(): IntegrationRow[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, provider, name, connection_id, config, active, created_at, updated_at FROM integrations ORDER BY name')
    .all() as Parameters<typeof rowToIntegration>[0][];
  return rows.map(rowToIntegration);
}

export function getIntegration(id: string): IntegrationRow | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT id, provider, name, connection_id, config, active, created_at, updated_at FROM integrations WHERE id = ?')
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
  connectionId: string | null;
  config: IntegrationConfig;
  credentials: IntegrationCredentials;
}): IntegrationRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO integrations (id, provider, name, connection_id, credentials, config) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, input.provider, input.name, input.connectionId, encrypt(JSON.stringify(input.credentials)), JSON.stringify(input.config));
  return getIntegration(id)!;
}

export function updateIntegration(
  id: string,
  patch: {
    name?: string;
    connectionId?: string | null;
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
        SET name = ?, connection_id = ?, config = ?, active = ?, updated_at = unixepoch()
      WHERE id = ?`
  ).run(
    patch.name ?? existing.name,
    patch.connectionId !== undefined ? patch.connectionId : existing.connectionId,
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
      `SELECT integration_id, server_url, zone_name, remote_zone_id, remote_type, custom_ns_set, status, message, updated_at
         FROM integration_zones WHERE integration_id = ? AND server_url = ? ORDER BY zone_name`
    )
    .all(integrationId, serverUrl) as Array<{
      integration_id: string; server_url: string; zone_name: string; remote_zone_id: string | null;
      remote_type: string | null; custom_ns_set: number | null; status: IntegrationZoneStatus; message: string | null; updated_at: number;
    }>;
  return rows.map((row) => ({
    integrationId: row.integration_id,
    serverUrl: row.server_url,
    zoneName: row.zone_name,
    remoteZoneId: row.remote_zone_id,
    remoteType: row.remote_type,
    customNsSet: row.custom_ns_set,
    status: row.status,
    message: row.message,
    updatedAt: row.updated_at,
  }));
}

export function upsertIntegrationZone(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
  state: { remoteZoneId?: string | null; remoteType?: string | null; status: IntegrationZoneStatus; message?: string | null }
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO integration_zones (integration_id, server_url, zone_name, remote_zone_id, remote_type, status, message, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(integration_id, server_url, zone_name) DO UPDATE SET
       remote_zone_id = excluded.remote_zone_id,
       remote_type = COALESCE(excluded.remote_type, integration_zones.remote_type),
       status = excluded.status,
       message = excluded.message,
       updated_at = excluded.updated_at`
  ).run(integrationId, serverUrl, zoneName, state.remoteZoneId ?? null, state.remoteType ?? null, state.status, state.message ?? null);
}

/**
 * Conditionally backfill the Cloudflare zone type for a still-healthy link.
 * Writes remote_type ONLY when the row still matches the snapshot the caller
 * acted on (same remoteZoneId, still 'ok', type not yet set). This is an UPDATE
 * (never an upsert), so it cannot re-insert a row deleted mid-flight, and the
 * WHERE guard prevents restoring an obsolete 'ok' state if the row changed
 * (purged, marked stale, re-provisioned) during the async Cloudflare lookup.
 * Returns true if a row was updated.
 */
export function backfillIntegrationZoneType(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
  remoteZoneId: string,
  remoteType: string
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE integration_zones SET remote_type = ?
        WHERE integration_id = ? AND server_url = ? AND zone_name = ?
          AND remote_zone_id = ? AND status = 'ok' AND remote_type IS NULL`
    )
    .run(remoteType, integrationId, serverUrl, zoneName, remoteZoneId);
  return result.changes > 0;
}

export function getIntegrationZone(
  integrationId: string,
  serverUrl: string,
  zoneName: string
): IntegrationZoneRow | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT integration_id, server_url, zone_name, remote_zone_id, remote_type, custom_ns_set, status, message, updated_at
         FROM integration_zones
        WHERE integration_id = ? AND server_url = ? AND zone_name = ?`
    )
    .get(integrationId, serverUrl, zoneName) as
      | {
          integration_id: string; server_url: string; zone_name: string; remote_zone_id: string | null;
          remote_type: string | null; custom_ns_set: number | null; status: IntegrationZoneStatus; message: string | null; updated_at: number;
        }
      | undefined;
  if (!row) return undefined;
  return {
    integrationId: row.integration_id,
    serverUrl: row.server_url,
    zoneName: row.zone_name,
    remoteZoneId: row.remote_zone_id,
    remoteType: row.remote_type,
    customNsSet: row.custom_ns_set,
    status: row.status,
    message: row.message,
    updatedAt: row.updated_at,
  };
}

/**
 * Records the zone's actual custom NS set (a set number, or null for
 * Cloudflare-default nameservers). Plain UPDATE keyed on the row — never inserts,
 * so it cannot resurrect a deleted link; a no-op if the row is gone.
 */
export function setIntegrationZoneNsSet(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
  nsSet: number | null
): void {
  const db = getDb();
  db.prepare(
    `UPDATE integration_zones SET custom_ns_set = ?, updated_at = unixepoch()
      WHERE integration_id = ? AND server_url = ? AND zone_name = ?`
  ).run(nsSet, integrationId, serverUrl, zoneName);
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

/**
 * Deletes a link only if it still references the given remote zone id — so a
 * concurrent re-provision that rewrote the link (new remoteZoneId) is not
 * clobbered by a late delete. Returns true if a row was removed.
 */
export function deleteIntegrationZoneIfRemote(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
  remoteZoneId: string
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      'DELETE FROM integration_zones WHERE integration_id = ? AND server_url = ? AND zone_name = ? AND remote_zone_id = ?'
    )
    .run(integrationId, serverUrl, zoneName, remoteZoneId);
  return result.changes > 0;
}
