import { getDb } from '@/lib/cache/db';
import { normalizeUrl } from '@/lib/cache/zones';
import * as cloudflare from './cloudflare';
import {
  getIntegration,
  getIntegrationCredentials,
  listIntegrations,
  listIntegrationZones,
  updateIntegration,
  upsertIntegrationZone,
  deleteIntegrationZone,
} from './store';
import type { IntegrationConfig, IntegrationCredentials, IntegrationRow } from './types';

/**
 * Reconcile engine: makes the provider side match the scoped PowerDNS zones.
 * Same pattern as the NS audit scan — detached run, module-level progress
 * state, results persisted so the UI loads instantly.
 */

export interface IntegrationSyncState {
  running: boolean;
  total: number;
  processed: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

const CONCURRENCY = 4;
const syncStates = new Map<string, IntegrationSyncState>();

export function getSyncState(integrationId: string): IntegrationSyncState {
  return (
    syncStates.get(integrationId) ?? {
      running: false, total: 0, processed: 0, startedAt: null, finishedAt: null, error: null,
    }
  );
}

// Zone names are stored canonical (trailing dot) like the zones cache;
// Cloudflare wants them bare.
function bareName(zoneName: string): string {
  return zoneName.replace(/\.$/, '');
}

function scopedZones(serverUrl: string, config: IntegrationConfig): Array<{ name: string; account: string }> {
  const db = getDb();
  const base = `SELECT name, account FROM zones
                 WHERE server_url = ? AND kind = 'Master'
                   AND NOT (name = 'in-addr.arpa.' OR name LIKE '%.in-addr.arpa.' OR name = 'ip6.arpa.' OR name LIKE '%.ip6.arpa.')`;
  if (config.scope === 'groups') {
    if (config.groups.length === 0) return [];
    const placeholders = config.groups.map(() => '?').join(',');
    return db
      .prepare(`${base} AND account IN (${placeholders}) ORDER BY name`)
      .all(normalizeUrl(serverUrl), ...config.groups) as Array<{ name: string; account: string }>;
  }
  return db.prepare(`${base} ORDER BY name`).all(normalizeUrl(serverUrl)) as Array<{ name: string; account: string }>;
}

function zoneInScope(config: IntegrationConfig, kind: string, account: string): boolean {
  if (kind !== 'Master') return false;
  if (config.scope === 'groups') return config.groups.includes(account);
  return true;
}

/**
 * Provisions one zone on the provider: ensure the AXFR peer exists, create
 * the secondary zone (reusing an existing one with the same name), link the
 * peer and trigger the initial transfer.
 */
async function provisionZone(
  integration: IntegrationRow,
  creds: IntegrationCredentials,
  zoneName: string
): Promise<void> {
  upsertIntegrationZone(integration.id, zoneName, { status: 'provisioning' });
  try {
    const config = integration.config;

    // Account-level peer/TSIG are created once, then persisted on the config.
    if (!config.peerId) {
      const { peerId, tsigId } = await cloudflare.ensurePeer(creds, config);
      config.peerId = peerId;
      config.tsigId = tsigId;
      updateIntegration(integration.id, { config });
    }

    let zone = await cloudflare.getZoneByName(creds, config.accountId, bareName(zoneName));
    if (!zone) {
      zone = await cloudflare.createSecondaryZone(creds, config.accountId, bareName(zoneName));
    }
    if (zone.type !== 'secondary') {
      upsertIntegrationZone(integration.id, zoneName, {
        remoteZoneId: zone.id,
        status: 'error',
        message: `Zone exists at Cloudflare with type "${zone.type}" (expected secondary) — not touching it`,
      });
      return;
    }

    await cloudflare.linkZoneToPeer(creds, zone.id, bareName(zoneName), config.peerId!);
    await cloudflare.forceAxfr(creds, zone.id);
    upsertIntegrationZone(integration.id, zoneName, { remoteZoneId: zone.id, status: 'ok', message: null });
  } catch (e) {
    upsertIntegrationZone(integration.id, zoneName, {
      status: 'error',
      message: e instanceof Error ? e.message : 'provisioning failed',
    });
  }
}

/** Starts a full reconcile for one integration. Returns false while running. */
export function startSync(integrationId: string, serverUrl: string): { started: boolean; reason?: string } {
  const current = getSyncState(integrationId);
  if (current.running) return { started: false, reason: 'A sync is already running' };

  const integration = getIntegration(integrationId);
  if (!integration || !integration.active) return { started: false, reason: 'Integration not found or inactive' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { started: false, reason: 'Stored credentials are unreadable (APP_SECRET changed?)' };

  const zones = scopedZones(serverUrl, integration.config);
  const known = listIntegrationZones(integrationId);
  const scopedNames = new Set(zones.map((z) => z.name));

  const state: IntegrationSyncState = {
    running: true,
    total: zones.length,
    processed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  syncStates.set(integrationId, state);

  void (async () => {
    try {
      // Zones we tracked that left the scope (deleted or reassigned): flag
      // them — remote deletion only ever happens through the explicit
      // deleteMode on zone deletion, never from a reconcile.
      for (const link of known) {
        if (!scopedNames.has(link.zoneName) && link.status !== 'orphan') {
          upsertIntegrationZone(integrationId, link.zoneName, {
            remoteZoneId: link.remoteZoneId,
            status: 'orphan',
            message: 'Zone no longer exists in PowerDNS (or left the integration scope)',
          });
        }
      }

      const linkByName = new Map(known.map((l) => [l.zoneName, l]));
      let index = 0;
      const worker = async () => {
        while (index < zones.length) {
          const zone = zones[index++];
          const link = linkByName.get(zone.name);
          // Healthy links are left alone so a reconcile stays cheap and
          // re-running it retries only failed/missing zones.
          if (!link || link.status !== 'ok') {
            const fresh = getIntegration(integrationId);
            if (fresh) await provisionZone(fresh, creds, zone.name);
          }
          state.processed++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, zones.length) }, worker));
    } catch (e) {
      state.error = e instanceof Error ? e.message : 'sync failed';
    } finally {
      state.running = false;
      state.finishedAt = Date.now();
    }
  })();

  return { started: true };
}

/**
 * Best-effort hook for zone creation: provisions the new zone on every
 * active integration whose scope matches. Fire-and-forget from API routes.
 */
export function autoProvisionZone(serverUrl: string, zoneName: string, kind: string, account: string): void {
  for (const integration of listIntegrations()) {
    if (!integration.active || !integration.config.autoProvision) continue;
    if (!zoneInScope(integration.config, kind, account)) continue;
    const creds = getIntegrationCredentials(integration.id);
    if (!creds) continue;
    void provisionZone(integration, creds, zoneName);
  }
}

/**
 * Best-effort hook for zone deletion: applies the integration's delete policy
 * (default: keep the remote zone and flag the link as orphan).
 */
export function handleZoneDeleted(zoneName: string): void {
  for (const integration of listIntegrations()) {
    const link = listIntegrationZones(integration.id).find((l) => l.zoneName === zoneName);
    if (!link) continue;
    if (integration.config.deleteMode === 'delete' && link.remoteZoneId) {
      const creds = getIntegrationCredentials(integration.id);
      if (!creds) continue;
      void cloudflare
        .deleteZone(creds, link.remoteZoneId)
        .then(() => deleteIntegrationZone(integration.id, zoneName))
        .catch((e: unknown) => {
          upsertIntegrationZone(integration.id, zoneName, {
            remoteZoneId: link.remoteZoneId,
            status: 'error',
            message: `Remote deletion failed: ${e instanceof Error ? e.message : 'unknown error'}`,
          });
        });
    } else {
      upsertIntegrationZone(integration.id, zoneName, {
        remoteZoneId: link.remoteZoneId,
        status: 'orphan',
        message: 'Zone deleted in PowerDNS — remote zone kept (deleteMode: never)',
      });
    }
  }
}

/**
 * First active integration replicating the given zone (used by the record
 * proxy/orange-cloud feature on the zone page).
 */
export function findZoneLink(zoneName: string) {
  for (const integration of listIntegrations()) {
    if (!integration.active) continue;
    const link = listIntegrationZones(integration.id).find(
      (l) => l.zoneName === zoneName && l.remoteZoneId && l.status !== 'orphan'
    );
    if (link) return { integration, link };
  }
  return undefined;
}

/** Re-triggers a transfer for one linked zone. */
export async function forceZoneAxfr(integrationId: string, zoneName: string): Promise<{ error?: string }> {
  const link = listIntegrationZones(integrationId).find((l) => l.zoneName === zoneName);
  if (!link?.remoteZoneId) return { error: 'Zone is not linked to a remote zone yet' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { error: 'Stored credentials are unreadable' };
  try {
    await cloudflare.forceAxfr(creds, link.remoteZoneId);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'force AXFR failed' };
  }
}
