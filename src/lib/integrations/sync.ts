import { getDb } from '@/lib/cache/db';
import { normalizeUrl } from '@/lib/cache/zones';
import { zoneExistsOnPdns } from '@/lib/pdns-proxy';
import * as cloudflare from './cloudflare';
import { getConnectionById } from './connections';
import {
  getIntegration,
  getIntegrationCredentials,
  getIntegrationZone,
  listIntegrations,
  listIntegrationZones,
  updateIntegration,
  upsertIntegrationZone,
  backfillIntegrationZoneType,
  deleteIntegrationZoneIfRemote,
  setIntegrationZoneNsSet,
} from './store';
import type { IntegrationConfig, IntegrationCredentials, IntegrationRow, IntegrationZoneRow } from './types';

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

// Guards a single (integration, server, zone) against concurrent provisioning
// from different entry points: autoProvisionZone calls provisionZone directly,
// bypassing the coarse syncStates.running flag, so it could otherwise race a
// manual sync or the background worker on the same zone.
const provisioningInFlight = new Set<string>();
const inFlightKey = (integrationId: string, serverUrl: string, zoneName: string) =>
  `${integrationId}|${normalizeUrl(serverUrl)}|${zoneName}`;

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

/** Names of the PowerDNS zones currently matching the integration scope. */
export function listScopedZoneNames(serverUrl: string, config: IntegrationConfig): string[] {
  return scopedZones(serverUrl, config).map((zone) => zone.name);
}

/** In-scope PowerDNS zones with their account (for the preview union). */
export function listScopedZones(serverUrl: string, config: IntegrationConfig): Array<{ name: string; account: string }> {
  return scopedZones(serverUrl, config);
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

// The actual provisioning work. Caller MUST already hold the in-flight key for
// (integration.id, serverUrl, zoneName) — this function does NOT re-check or
// re-add the reserve, so provisionZone and provisionOneZone can share the body.
async function provisionZoneLocked(
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
  const existingLink = getIntegrationZone(integration.id, serverUrl, zoneName);
  let currentRemoteId = existingLink?.remoteZoneId ?? null;
  upsertIntegrationZone(integration.id, serverUrl, zoneName, {
    remoteZoneId: currentRemoteId,
    status: 'provisioning',
  });
  try {
    const config = integration.config;
    const warnings: string[] = [];
    const peerId = await ensurePeerOnce(integration, creds);

    let zone = await cloudflare.getZoneByName(creds, config.accountId, bareName(zoneName));
    const zonePreExisted = Boolean(zone);
    if (!zone) {
      zone = await cloudflare.createSecondaryZone(creds, config.accountId, bareName(zoneName));
    }
    currentRemoteId = zone.id;
    if (zone.type !== 'secondary') {
      upsertIntegrationZone(integration.id, serverUrl, zoneName, {
        remoteZoneId: zone.id,
        remoteType: zone.type,
        status: 'error',
        message: `Zone exists at Cloudflare with type "${zone.type}" (expected secondary) — not touching it`,
      });
      return;
    }

    // Cloudflare Secondary DNS (incoming transfers) is Enterprise-only, so an
    // existing zone we adopt is necessarily already Enterprise — never try to set
    // its plan. Doing so on an adopted zone surfaces a spurious "10000:
    // Authentication error" when the integration token lacks billing permission
    // (e.g. an account-owned token whose zone listing omits `plan`, so the
    // enterprise check below can't short-circuit). Only a zone we just created
    // may need the upgrade, before the Enterprise-only linkZoneToPeer. Best-effort.
    if (!zonePreExisted && zone.plan?.id !== 'enterprise') {
      try {
        await cloudflare.setZonePlan(creds, zone.id);
      } catch (e) {
        warnings.push(`Enterprise plan not set: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }

    try {
      await cloudflare.linkZoneToPeer(creds, zone.id, bareName(zoneName), peerId);
    } catch (e) {
      // Cloudflare error 409: the zone already has an incoming transfer
      // config (pre-existing manual setup). Adopt it ONLY when that config
      // actually points at our peer — a conflict with a different peer must
      // stay visible, otherwise the zone would silently keep transferring
      // from the wrong source while being reported ok.
      const alreadyLinked =
        e instanceof cloudflare.CloudflareError &&
        (e.codes.includes(409) || /already linked/i.test(e.message));
      if (!alreadyLinked) throw e;
      const incoming = await cloudflare.getZoneIncoming(creds, zone.id);
      const linkedPeers = incoming?.peers ?? [];
      if (!linkedPeers.includes(peerId)) {
        upsertIntegrationZone(integration.id, serverUrl, zoneName, {
          remoteZoneId: zone.id,
          remoteType: zone.type,
          status: 'error',
          message: `Zone is linked to a different peer (${linkedPeers.join(', ') || 'unknown'}) — unlink it at Cloudflare or align the integration transfer settings`,
        });
        return;
      }
    }

    // Custom NS (adopt-don't-touch): the integration's global policy applies ONLY
    // to a zone we just created — an existing/adopted zone keeps its current
    // Cloudflare nameservers. Per-zone changes go through setZoneCustomNsSet.
    if (!zonePreExisted && config.customNsMode !== 'ignore') {
      await cloudflare.setZoneCustomNs(creds, zone.id, config.customNsMode === 'enable', config.customNsSet || 1);
    }
    await cloudflare.forceAxfr(creds, zone.id);
    // Enforce the configured override state both ways (enabling and disabling),
    // so a toggle re-provision propagates to Cloudflare. Best-effort.
    try {
      await cloudflare.setSecondaryOverride(creds, zone.id, config.secondaryOverride);
    } catch (e) {
      warnings.push(
        `Secondary DNS override not ${config.secondaryOverride ? 'enabled' : 'disabled'}: ${e instanceof Error ? e.message : 'unknown error'}`
      );
    }
    upsertIntegrationZone(integration.id, serverUrl, zoneName, {
      remoteZoneId: zone.id,
      remoteType: zone.type,
      status: 'ok',
      message: warnings.length ? warnings.join('; ') : null,
    });
    // Reflect the zone's actual custom NS set in the table (best-effort; the
    // helper returns null on any error and never throws).
    setIntegrationZoneNsSet(integration.id, serverUrl, zoneName, await cloudflare.getZoneCustomNs(creds, zone.id));
  } catch (e) {
    upsertIntegrationZone(integration.id, serverUrl, zoneName, {
      remoteZoneId: currentRemoteId,
      status: 'error',
      message: e instanceof Error ? e.message : 'provisioning failed',
    });
  }
}

async function provisionZone(
  integration: IntegrationRow,
  creds: IntegrationCredentials,
  serverUrl: string,
  zoneName: string
): Promise<void> {
  const flightKey = inFlightKey(integration.id, serverUrl, zoneName);
  if (provisioningInFlight.has(flightKey)) return; // another path is provisioning this zone
  provisioningInFlight.add(flightKey);
  try { await provisionZoneLocked(integration, creds, serverUrl, zoneName); }
  finally { provisioningInFlight.delete(flightKey); }
}

export type ProvisionOneResult =
  | { ok: true; row: IntegrationZoneRow }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Atomically provisions a single in-scope zone for a manual sync. Owns the
 * in-flight reserve itself (synchronous check+add → no TOCTOU), so a duplicate
 * click or a concurrent big sync gets a clean 409 instead of a transient row.
 */
export async function provisionOneZone(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
): Promise<ProvisionOneResult> {
  const integration = getIntegration(integrationId);
  if (!integration) return { ok: false, status: 404, error: 'Integration not found' };
  if (!integration.active) return { ok: false, status: 400, error: 'Integration is inactive' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { ok: false, status: 400, error: 'Stored credentials are unreadable' };
  const normalizedUrl = normalizeUrl(serverUrl);

  if (getSyncState(integrationId, normalizedUrl).running) {
    return { ok: false, status: 409, error: 'A full sync is running — try again when it finishes' };
  }
  const inScope = scopedZones(normalizedUrl, integration.config).some(
    (z) => z.name.replace(/\.$/, '').toLowerCase() === zoneName.replace(/\.$/, '').toLowerCase(),
  );
  if (!inScope) return { ok: false, status: 409, error: 'Zone is not in the integration PowerDNS scope' };

  const flightKey = inFlightKey(integrationId, normalizedUrl, zoneName);
  if (provisioningInFlight.has(flightKey)) {
    return { ok: false, status: 409, error: 'This zone is already being provisioned — try again in a moment' };
  }
  provisioningInFlight.add(flightKey);
  try {
    await provisionZoneLocked(integration, creds, normalizedUrl, zoneName);
  } finally {
    provisioningInFlight.delete(flightKey);
  }
  const row = getIntegrationZone(integrationId, normalizedUrl, zoneName);
  if (!row) return { ok: false, status: 404, error: 'Provisioning produced no zone row' };
  return { ok: true, row };
}

// Deletion in-flight guard, separate from provisioning, keyed the same way.
const deletingInFlight = new Set<string>();

// Race-safe remote deletion shared by the UI hook, the worker pass and the purge
// endpoint: one delete per link at a time; CF 404 is success (deleteZone handles
// it); the link row is removed only if it still points at the same remoteZoneId,
// and an error is recorded only if the row still references that remote id.
async function deleteZoneLink(
  integration: IntegrationRow,
  creds: IntegrationCredentials,
  serverUrl: string,
  zoneName: string,
  remoteZoneId: string
): Promise<{ ok: boolean; error?: string }> {
  // Key includes remoteZoneId so a delete of a *different* remote zone for the
  // same name (zone recreated/re-provisioned mid-flight) is not coalesced away.
  const key = `${inFlightKey(integration.id, serverUrl, zoneName)}|${remoteZoneId}`;
  if (deletingInFlight.has(key)) return { ok: false, error: 'A deletion for this zone is already in progress' };
  deletingInFlight.add(key);
  try {
    await cloudflare.deleteZone(creds, remoteZoneId);
    deleteIntegrationZoneIfRemote(integration.id, serverUrl, zoneName, remoteZoneId);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    const current = getIntegrationZone(integration.id, serverUrl, zoneName);
    if (current && current.remoteZoneId === remoteZoneId) {
      // Keep it an orphan (gone from source, remote remains) so the worker and
      // the manual purge button can retry — NOT 'error' (which is reserved for
      // provisioning refusals that must never be deleted).
      upsertIntegrationZone(integration.id, serverUrl, zoneName, {
        remoteZoneId,
        status: 'orphan',
        message: `Remote deletion failed — will retry: ${message}`,
      });
    }
    return { ok: false, error: `Remote deletion failed: ${message}` };
  } finally {
    deletingInFlight.delete(key);
  }
}

interface ReconcileContext {
  integrationId: string;
  serverUrl: string; // normalized
  creds: IntegrationCredentials;
  state: IntegrationSyncState;
  zones: ReturnType<typeof scopedZones>;
  known: ReturnType<typeof listIntegrationZones>;
  allowDeletion: boolean;
}

// Validates + reserves the running slot. Returns the context, or a reason it
// could not start (already running, missing/inactive, unreadable creds).
function reserveSync(
  integrationId: string,
  serverUrl: string,
  allowDeletion: boolean
): { ok: true; ctx: ReconcileContext } | { ok: false; reason: string } {
  const current = getSyncState(integrationId, serverUrl);
  if (current.running) return { ok: false, reason: 'A sync is already running' };

  const integration = getIntegration(integrationId);
  if (!integration || !integration.active) return { ok: false, reason: 'Integration not found or inactive' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { ok: false, reason: 'Stored credentials are unreadable (APP_SECRET changed?)' };

  const normalizedUrl = normalizeUrl(serverUrl);
  const zones = scopedZones(normalizedUrl, integration.config);
  const known = listIntegrationZones(integrationId, normalizedUrl);

  const state: IntegrationSyncState = {
    running: true,
    total: zones.length,
    processed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  syncStates.set(syncKey(integrationId, serverUrl), state);
  return { ok: true, ctx: { integrationId, serverUrl: normalizedUrl, creds, state, zones, known, allowDeletion } };
}

// The reconcile body. Resolves when the pass is complete.
async function runReconcile(ctx: ReconcileContext): Promise<void> {
  const { integrationId, serverUrl: normalizedUrl, creds, state, zones, known } = ctx;
  try {
    const scopedNames = new Set(zones.map((z) => z.name));

    // Zones we tracked that left the scope: flag orphan (never remote-delete here).
    for (const link of known) {
      // Re-flag out-of-scope links back to 'orphan' (restarting the retention
      // grace), but NEVER 'error' rows: those are provisioning refusals (e.g. an
      // existing non-secondary CF zone, or one linked to a different peer) that
      // the integration does not own and must never auto-delete or purge.
      if (!scopedNames.has(link.zoneName) && link.status !== 'orphan' && link.status !== 'error') {
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
        if (!link || link.status !== 'ok') {
          const fresh = getIntegration(integrationId);
          if (fresh) await provisionZone(fresh, creds, normalizedUrl, zone.name);
        } else if (link.remoteZoneId) {
          const fresh = getIntegration(integrationId);
          if (fresh) {
            try {
              // One-time backfill of the Cloudflare zone type (predates remote_type).
              if (link.remoteType == null) {
                const cfZone = await cloudflare.getZoneByName(creds, fresh.config.accountId, bareName(zone.name));
                if (cfZone) backfillIntegrationZoneType(integrationId, normalizedUrl, zone.name, link.remoteZoneId, cfZone.type);
              }
              // Refresh the actual custom NS set for the table (secondary zones only).
              if (link.remoteType === 'secondary') {
                setIntegrationZoneNsSet(integrationId, normalizedUrl, zone.name, await cloudflare.getZoneCustomNs(creds, link.remoteZoneId));
              }
            } catch {
              // Best-effort: leave values as-is and retry next sync.
            }
          }
        }
        state.processed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, zones.length) }, worker));

    // Worker-only mirror deletion: remove remote zones whose PowerDNS zone is gone.
    if (ctx.allowDeletion) {
      const fresh = getIntegration(integrationId);
      if (fresh && fresh.config.deleteMode === 'auto') {
        await deleteAgedOrphans(fresh, creds, normalizedUrl, scopedNames);
      }
    }
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'sync failed';
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
  }
}

const ORPHAN_DELETE_MAX = Math.max(1, Number(process.env.INTEGRATION_ORPHAN_DELETE_MAX) || 50);

// Deletes orphaned remote zones for an 'auto' integration, with: retention grace,
// "still in scope" exclusion, a per-cycle circuit breaker, and a live PowerDNS
// existence check (authoritative) before each delete.
async function deleteAgedOrphans(
  integration: IntegrationRow,
  creds: IntegrationCredentials,
  serverUrl: string,
  scopedNames: Set<string>
): Promise<void> {
  const conn = integration.connectionId ? getConnectionById(integration.connectionId) : undefined;
  if (!conn) return; // can't verify against PowerDNS → never delete

  const retentionSec = Math.max(1, integration.config.orphanRetentionHours || 72) * 3600;
  const nowSec = Math.floor(Date.now() / 1000);
  // Candidates: out-of-scope, aged, with a remote zone. 'error' rows are failed
  // prior deletions (provisioning errors are in-scope → excluded by !scopedNames).
  const candidates = listIntegrationZones(integration.id, serverUrl).filter(
    (l) =>
      l.status === 'orphan' &&
      l.remoteZoneId &&
      !scopedNames.has(l.zoneName) &&
      nowSec - l.updatedAt >= retentionSec
  );
  if (candidates.length === 0) return;

  // Authoritative guard: only zones the live PowerDNS confirms are gone.
  const gone: typeof candidates = [];
  for (const link of candidates) {
    try {
      if (!(await zoneExistsOnPdns(conn.url, conn.apiKey, 'localhost', link.zoneName))) gone.push(link);
    } catch {
      // unknown PowerDNS state → skip (never delete on uncertainty)
    }
  }
  if (gone.length === 0) return;

  // Circuit breaker applies to CONFIRMED-GONE zones only, so a legitimate scope
  // reduction (many out-of-scope-but-still-alive orphans) cannot permanently
  // block deletion of genuinely removed zones.
  if (gone.length > ORPHAN_DELETE_MAX) {
    console.warn(
      `[reconcile] ${gone.length} confirmed-gone zones exceed INTEGRATION_ORPHAN_DELETE_MAX=${ORPHAN_DELETE_MAX} for "${integration.name}" — skipping deletions this cycle`
    );
    return;
  }

  for (const link of gone) {
    await deleteZoneLink(integration, creds, serverUrl, link.zoneName, link.remoteZoneId!);
  }
}

/** Starts a full reconcile for one integration (detached). Returns false while running. */
export function startSync(integrationId: string, serverUrl: string): { started: boolean; reason?: string } {
  const reserved = reserveSync(integrationId, serverUrl, false);
  if (!reserved.ok) return { started: false, reason: reserved.reason };
  void runReconcile(reserved.ctx);
  return { started: true };
}

/** Awaitable reconcile for the background worker. Skips if already running. */
export async function runSync(
  integrationId: string,
  serverUrl: string,
  opts: { allowDeletion?: boolean } = {}
): Promise<{ ran: boolean; reason?: string }> {
  const reserved = reserveSync(integrationId, serverUrl, opts.allowDeletion ?? false);
  if (!reserved.ok) return { ran: false, reason: reserved.reason };
  await runReconcile(reserved.ctx);
  return { ran: true };
}

/**
 * Best-effort hook for zone creation: provisions the new zone on every
 * active integration whose scope matches. Fire-and-forget from API routes.
 */
export function autoProvisionZone(serverUrl: string, zoneName: string, kind: string, account: string): void {
  const normalizedUrl = normalizeUrl(serverUrl);
  for (const integration of listIntegrations()) {
    if (!integration.active || !integration.config.autoProvision) continue;
    if (!integration.connectionId) continue;
    const conn = getConnectionById(integration.connectionId);
    if (!conn || normalizeUrl(conn.url) !== normalizedUrl) continue;
    if (!zoneInScope(integration.config, kind, account, zoneName)) continue;
    const creds = getIntegrationCredentials(integration.id);
    if (!creds) continue;
    void provisionZone(integration, creds, normalizedUrl, zoneName);
  }
}

/** Manually purge one orphaned remote zone (UI action). Returns an error string on failure. */
export async function purgeOrphanZone(integrationId: string, serverUrl: string, zoneName: string): Promise<{ error?: string }> {
  const normalizedUrl = normalizeUrl(serverUrl);
  const integration = getIntegration(integrationId);
  if (!integration) return { error: 'Integration not found' };
  if (integration.config.deleteMode === 'never') return { error: 'Deletion is disabled (deleteMode: never)' };
  const link = getIntegrationZone(integrationId, normalizedUrl, zoneName);
  if (!link || link.status !== 'orphan' || !link.remoteZoneId) return { error: 'No orphan link to purge for this zone' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { error: 'Stored credentials are unreadable' };
  const result = await deleteZoneLink(integration, creds, normalizedUrl, zoneName, link.remoteZoneId);
  return result.ok ? {} : { error: result.error || 'Remote deletion failed' };
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
    // 'error' links are provisioning refusals (a zone we don't own) — never
    // delete or orphan them. Consistent with the worker/purge paths.
    if (link.status === 'error') continue;
    if (integration.config.deleteMode === 'auto' && link.remoteZoneId) {
      const creds = getIntegrationCredentials(integration.id);
      if (!creds) continue;
      void deleteZoneLink(integration, creds, normalizedUrl, zoneName, link.remoteZoneId);
    } else {
      upsertIntegrationZone(integration.id, normalizedUrl, zoneName, {
        remoteZoneId: link.remoteZoneId,
        status: 'orphan',
        message: 'Zone deleted in PowerDNS — remote zone kept',
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

/**
 * Canonical names of every zone currently replicated to a provider as a
 * healthy secondary on this server: an active integration holds a link to a
 * remote zone that is neither orphaned nor errored. Errored links keep their
 * remoteZoneId (e.g. a Cloudflare zone of the wrong type, or one linked to a
 * different peer) but are not a working secondary, so they must not be flagged.
 * Collected across all zones so the list / switcher can mark them in one query.
 */
export function listReplicatedZoneNames(serverUrl: string): string[] {
  const normalizedUrl = normalizeUrl(serverUrl);
  const names = new Set<string>();
  for (const integration of listIntegrations()) {
    if (!integration.active) continue;
    for (const link of listIntegrationZones(integration.id, normalizedUrl)) {
      if (link.remoteZoneId && link.status !== 'orphan' && link.status !== 'error') {
        names.add(link.zoneName);
      }
    }
  }
  return [...names];
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

/**
 * Sets the per-zone custom NS set: nsSet (a positive integer) enables that account
 * custom-NS set on the zone; null switches it back to Cloudflare-default
 * nameservers. Applied directly to Cloudflare and guarded by the per-zone
 * provisioning lock so it can't race a concurrent sync. Records the new actual set
 * for the table. Discriminated result maps to an HTTP status.
 */
export async function setZoneCustomNsSet(
  integrationId: string,
  serverUrl: string,
  zoneName: string,
  nsSet: number | null
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409 | 502; error: string }> {
  if (nsSet !== null && (!Number.isInteger(nsSet) || nsSet <= 0)) {
    return { ok: false, status: 400, error: 'nsSet must be a positive integer or null' };
  }
  const normalizedUrl = normalizeUrl(serverUrl);
  const integration = getIntegration(integrationId);
  if (!integration) return { ok: false, status: 404, error: 'Integration not found' };
  const creds = getIntegrationCredentials(integrationId);
  if (!creds) return { ok: false, status: 409, error: 'Stored credentials are unreadable' };
  const link = getIntegrationZone(integrationId, normalizedUrl, zoneName);
  if (!link || link.status !== 'ok' || link.remoteType !== 'secondary' || !link.remoteZoneId) {
    return { ok: false, status: 409, error: 'Custom NS set can only be changed on a healthy secondary zone' };
  }
  const flightKey = inFlightKey(integrationId, normalizedUrl, zoneName);
  if (provisioningInFlight.has(flightKey)) {
    return { ok: false, status: 409, error: 'A sync is provisioning this zone — try again in a moment' };
  }
  provisioningInFlight.add(flightKey);
  try {
    await cloudflare.setZoneCustomNs(creds, link.remoteZoneId, nsSet !== null, nsSet ?? 1);
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : 'Failed to update custom NS at Cloudflare' };
  } finally {
    provisioningInFlight.delete(flightKey);
  }
  setIntegrationZoneNsSet(integrationId, normalizedUrl, zoneName, nsSet);
  return { ok: true };
}
