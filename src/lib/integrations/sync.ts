import { getDb } from '@/lib/cache/db';
import { normalizeUrl } from '@/lib/cache/zones';
import * as cloudflare from './cloudflare';
import {
  getIntegration,
  getIntegrationCredentials,
  getIntegrationZone,
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
// Serializes account-level peer/TSIG creation per integration: concurrent
// provisioning (first sync, simultaneous zone creations) must not create
// duplicate Cloudflare peers.
const peerLocks = new Map<string, Promise<void>>();

// Progress is per integration AND per PowerDNS server: a sync against one
// connection must not show as running (or block syncs) on another.
function syncKey(integrationId: string, serverUrl: string): string {
  return `${integrationId}|${normalizeUrl(serverUrl)}`;
}

export function getSyncState(integrationId: string, serverUrl: string): IntegrationSyncState {
  return (
    syncStates.get(syncKey(integrationId, serverUrl)) ?? {
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
  // Explicit zone selection: the admin picked them, so the kind filter does
  // not apply (Cloudflare polls via auto_refresh even without NOTIFY).
  if (config.scope === 'zones') {
    if (config.zones.length === 0) return [];
    const placeholders = config.zones.map(() => '?').join(',');
    // Config zone names are stored lowercase; the cache keeps PowerDNS names
    // verbatim, so compare case-insensitively (DNS names are anyway).
    return db
      .prepare(
        `SELECT name, account FROM zones
          WHERE server_url = ? AND LOWER(name) IN (${placeholders}) ORDER BY name`
      )
      .all(normalizeUrl(serverUrl), ...config.zones) as Array<{ name: string; account: string }>;
  }
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

function zoneInScope(config: IntegrationConfig, kind: string, account: string, zoneName: string): boolean {
  if (config.scope === 'zones') return config.zones.includes(zoneName.toLowerCase());
  if (kind !== 'Master') return false;
  if (config.scope === 'groups') return config.groups.includes(account);
  return true;
}

/**
 * Provisions one zone on the provider: ensure the AXFR peer exists, create
 * the secondary zone (reusing an existing one with the same name), link the
 * peer and trigger the initial transfer.
 */
// Account-level peer/TSIG are created once then persisted on the config;
// concurrent callers await the same in-flight creation.
async function ensurePeerOnce(integration: IntegrationRow, creds: IntegrationCredentials): Promise<string> {
  if (integration.config.peerId) return integration.config.peerId;

  let pending = peerLocks.get(integration.id);
  if (!pending) {
    pending = (async () => {
      // Re-read: another caller may have persisted the peer meanwhile.
      const fresh = getIntegration(integration.id) ?? integration;
      if (fresh.config.peerId) return;
      const { peerId, tsigId } = await cloudflare.ensurePeer(creds, fresh.config);
      fresh.config.peerId = peerId;
      fresh.config.tsigId = tsigId;
      updateIntegration(integration.id, { config: fresh.config });
    })().finally(() => peerLocks.delete(integration.id));
    peerLocks.set(integration.id, pending);
  }
  await pending;

  const updated = getIntegration(integration.id);
  const peerId = updated?.config.peerId;
  if (!peerId) throw new Error('Cloudflare peer creation failed');
  return peerId;
}

async function provisionZone(
  integration: IntegrationRow,
  creds: IntegrationCredentials,
  serverUrl: string,
  zoneName: string
): Promise<void> {
  // A stale/errored link being retried may already know its remote zone id;
  // keep it through the provisioning states so a failed retry (bad peer
  // edit, transient Cloudflare outage) doesn't lose the working reference.
  // Once the retry has found/created a (possibly different) remote zone,
  // that id supersedes the old one — even on the failure path.
  let currentRemoteId = getIntegrationZone(integration.id, serverUrl, zoneName)?.remoteZoneId ?? null;
  upsertIntegrationZone(integration.id, serverUrl, zoneName, {
    remoteZoneId: currentRemoteId,
    status: 'provisioning',
  });
  try {
    const config = integration.config;
    const peerId = await ensurePeerOnce(integration, creds);

    let zone = await cloudflare.getZoneByName(creds, config.accountId, bareName(zoneName));
    if (!zone) {
      zone = await cloudflare.createSecondaryZone(creds, config.accountId, bareName(zoneName));
    }
    currentRemoteId = zone.id;
    if (zone.type !== 'secondary') {
      upsertIntegrationZone(integration.id, serverUrl, zoneName, {
        remoteZoneId: zone.id,
        status: 'error',
        message: `Zone exists at Cloudflare with type "${zone.type}" (expected secondary) — not touching it`,
      });
      return;
    }

    await cloudflare.linkZoneToPeer(creds, zone.id, bareName(zoneName), peerId);
    if (config.customNsMode !== 'ignore') {
      await cloudflare.setZoneCustomNs(creds, zone.id, config.customNsMode === 'enable', config.customNsSet || 1);
    }
    await cloudflare.forceAxfr(creds, zone.id);
    upsertIntegrationZone(integration.id, serverUrl, zoneName, { remoteZoneId: zone.id, status: 'ok', message: null });
  } catch (e) {
    upsertIntegrationZone(integration.id, serverUrl, zoneName, {
      remoteZoneId: currentRemoteId,
      status: 'error',
      message: e instanceof Error ? e.message : 'provisioning failed',
    });
  }
}

/** Starts a full reconcile for one integration. Returns false while running. */
export function startSync(integrationId: string, serverUrl: string): { started: boolean; reason?: string } {
  const current = getSyncState(integrationId, serverUrl);
  if (current.running) return { started: false, reason: 'A sync is already running' };

  const integration = getIntegration(integrationId);
  if (!integration || !integration.active) return { started: false, reason: 'Integration not found or inactive' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { started: false, reason: 'Stored credentials are unreadable (APP_SECRET changed?)' };

  const normalizedUrl = normalizeUrl(serverUrl);
  const zones = scopedZones(serverUrl, integration.config);
  const known = listIntegrationZones(integrationId, normalizedUrl);
  const scopedNames = new Set(zones.map((z) => z.name));

  const state: IntegrationSyncState = {
    running: true,
    total: zones.length,
    processed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  syncStates.set(syncKey(integrationId, serverUrl), state);

  void (async () => {
    try {
      // Zones we tracked that left the scope (deleted or reassigned): flag
      // them — remote deletion only ever happens through the explicit
      // deleteMode on zone deletion, never from a reconcile.
      for (const link of known) {
        if (!scopedNames.has(link.zoneName) && link.status !== 'orphan') {
          upsertIntegrationZone(integrationId, normalizedUrl, link.zoneName, {
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
            if (fresh) await provisionZone(fresh, creds, normalizedUrl, zone.name);
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
  const normalizedUrl = normalizeUrl(serverUrl);
  for (const integration of listIntegrations()) {
    if (!integration.active || !integration.config.autoProvision) continue;
    if (!zoneInScope(integration.config, kind, account, zoneName)) continue;
    const creds = getIntegrationCredentials(integration.id);
    if (!creds) continue;
    void provisionZone(integration, creds, normalizedUrl, zoneName);
  }
}

/**
 * Best-effort hook for zone deletion: applies the integration's delete policy
 * (default: keep the remote zone and flag the link as orphan).
 */
export function handleZoneDeleted(serverUrl: string, zoneName: string): void {
  const normalizedUrl = normalizeUrl(serverUrl);
  for (const integration of listIntegrations()) {
    const link = listIntegrationZones(integration.id, normalizedUrl).find((l) => l.zoneName === zoneName);
    if (!link) continue;
    if (integration.config.deleteMode === 'delete' && link.remoteZoneId) {
      const creds = getIntegrationCredentials(integration.id);
      if (!creds) continue;
      void cloudflare
        .deleteZone(creds, link.remoteZoneId)
        .then(() => deleteIntegrationZone(integration.id, normalizedUrl, zoneName))
        .catch((e: unknown) => {
          upsertIntegrationZone(integration.id, normalizedUrl, zoneName, {
            remoteZoneId: link.remoteZoneId,
            status: 'error',
            message: `Remote deletion failed: ${e instanceof Error ? e.message : 'unknown error'}`,
          });
        });
    } else {
      upsertIntegrationZone(integration.id, normalizedUrl, zoneName, {
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
export function findZoneLink(serverUrl: string, zoneName: string) {
  const normalizedUrl = normalizeUrl(serverUrl);
  for (const integration of listIntegrations()) {
    if (!integration.active) continue;
    const link = listIntegrationZones(integration.id, normalizedUrl).find(
      (l) => l.zoneName === zoneName && l.remoteZoneId && l.status !== 'orphan'
    );
    if (link) return { integration, link };
  }
  return undefined;
}

/** Re-triggers a transfer for one linked zone. */
export async function forceZoneAxfr(integrationId: string, serverUrl: string, zoneName: string): Promise<{ error?: string }> {
  const link = listIntegrationZones(integrationId, normalizeUrl(serverUrl)).find((l) => l.zoneName === zoneName);
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
