import type { CfZone } from './cloudflare';
import { listZones } from './cloudflare';
import type { IntegrationZoneRow, IntegrationZoneStatus } from './types';
import { getIntegration, getIntegrationCredentials, listIntegrationZones } from './store';
import { getConnectionById } from './connections';
import { normalizeUrl } from '@/lib/cache/zones';
import { refreshZonesCache } from '@/lib/cache/refresh-zones';
import { listMasterZones, getSyncState } from './sync';
import type { IntegrationSyncState } from './sync';

export type ZonePreviewState = 'tracked' | 'adopt' | 'create' | 'cf-only' | 'unknown';

export interface ZonePreviewRow {
  zoneName: string;
  previewState: ZonePreviewState;
  inPdns: boolean;
  account: string | null;
  cfPresent: boolean;
  cfType: string | null;
  cfZoneId: string | null;
  syncable: boolean;
  status?: IntegrationZoneStatus;
  message?: string | null;
  remoteType?: string | null;
  remoteZoneId?: string | null;
  customNsSet?: number | null;
  updatedAt?: number;
}

/** Lower-case + strip a single trailing dot. DNS names are case-insensitive. */
function joinKey(name: string): string {
  return name.replace(/\.$/, '').toLowerCase();
}

export function computePreviewRows(
  pdnsZones: Array<{ name: string; account: string }>,
  cfZones: CfZone[] | null,           // null = no CF data available at all
  trackedRows: IntegrationZoneRow[],
): ZonePreviewRow[] {
  const pdnsByKey = new Map(pdnsZones.map((z) => [joinKey(z.name), z]));
  const cfByKey = cfZones ? new Map(cfZones.map((z) => [joinKey(z.name), z])) : null;
  const trackedByKey = new Map(trackedRows.map((r) => [joinKey(r.zoneName), r]));

  const keys = new Set<string>([...pdnsByKey.keys(), ...trackedByKey.keys()]);
  if (cfByKey) for (const k of cfByKey.keys()) keys.add(k);

  const rows: ZonePreviewRow[] = [];
  for (const key of keys) {
    const pdns = pdnsByKey.get(key);
    const cf = cfByKey?.get(key) ?? null;
    const tr = trackedByKey.get(key);
    const inPdns = Boolean(pdns);
    const cfPresent = Boolean(cf);

    let previewState: ZonePreviewState;
    if (tr) previewState = 'tracked';
    else if (inPdns && cfByKey === null) previewState = 'unknown';
    else if (inPdns && cfPresent) previewState = 'adopt';
    else if (inPdns) previewState = 'create';
    else previewState = 'cf-only';

    const status = tr?.status;
    const syncable = inPdns && status !== 'provisioning';

    rows.push({
      zoneName: pdns?.name ?? tr?.zoneName ?? cf?.name ?? key,
      previewState,
      inPdns,
      account: pdns?.account ?? null,
      cfPresent,
      cfType: cf?.type ?? tr?.remoteType ?? null,
      cfZoneId: cf?.id ?? tr?.remoteZoneId ?? null,
      syncable,
      ...(tr
        ? {
            status: tr.status,
            message: tr.message,
            remoteType: tr.remoteType,
            remoteZoneId: tr.remoteZoneId,
            customNsSet: tr.customNsSet,
            updatedAt: tr.updatedAt,
          }
        : {}),
    });
  }
  rows.sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  return rows;
}

// ---------------------------------------------------------------------------
// CF zone-list cache: coalesced, account-keyed, stale-on-failure
// ---------------------------------------------------------------------------

interface CfCacheEntry {
  fetchedAt: number;
  zones: CfZone[];
  pending: Promise<CfZone[]> | null;
}
const cfCache = new Map<string, CfCacheEntry>();

/** Test-only: clear the module cache. */
export function __resetCfCache(): void {
  cfCache.clear();
}

export interface CachedCfZones {
  zones: CfZone[] | null;   // null only when there is no cached data at all
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
}

const CF_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns the account's CF zones, cached per `key` with TTL, in-flight coalescing,
 * and stale-on-failure. `fetcher` is injected so callers (and tests) control the
 * actual Cloudflare call.
 */
export async function getCachedCfZones(
  key: string,
  fetcher: () => Promise<CfZone[]>,
  opts: { refresh?: boolean; ttlMs?: number } = {},
): Promise<CachedCfZones> {
  const ttl = opts.ttlMs ?? CF_CACHE_TTL_MS;
  const now = Date.now();
  const entry = cfCache.get(key);

  if (!opts.refresh && entry && entry.fetchedAt && now - entry.fetchedAt < ttl) {
    return { zones: entry.zones, fetchedAt: entry.fetchedAt, stale: false, error: null };
  }
  if (entry?.pending) {
    try {
      const zones = await entry.pending;
      return { zones, fetchedAt: cfCache.get(key)?.fetchedAt ?? now, stale: false, error: null };
    } catch (e) {
      return staleOrNull(cfCache.get(key), e);
    }
  }

  const pending = fetcher();
  const base: CfCacheEntry = entry ?? { fetchedAt: 0, zones: [], pending: null };
  cfCache.set(key, { ...base, pending });
  try {
    const zones = await pending;
    const fetchedAt = Date.now();
    cfCache.set(key, { fetchedAt, zones, pending: null });
    return { zones, fetchedAt, stale: false, error: null };
  } catch (e) {
    const prev = cfCache.get(key);
    cfCache.set(key, { fetchedAt: prev?.fetchedAt ?? 0, zones: prev?.zones ?? [], pending: null });
    return staleOrNull(prev && prev.fetchedAt ? prev : undefined, e);
  }
}

function staleOrNull(entry: CfCacheEntry | undefined, e: unknown): CachedCfZones {
  const error = e instanceof Error ? e.message : 'Cloudflare listing failed';
  if (entry && entry.zones && entry.fetchedAt) {
    return { zones: entry.zones, fetchedAt: entry.fetchedAt, stale: true, error };
  }
  return { zones: null, fetchedAt: null, stale: false, error };
}

// ---------------------------------------------------------------------------
// High-level preview builder: union of PDNS scope, CF zones, and tracked state
// ---------------------------------------------------------------------------

export interface ZonePreview {
  rows: ZonePreviewRow[];
  sync: IntegrationSyncState;
  cf: { fetchedAt: number | null; stale: boolean; error: string | null };
  pdns: { fetchedAt: number | null; stale: boolean; error: string | null };
  counts: { adopt: number; create: number; cfOnly: number; tracked: number; unknown: number };
  connectionMissing: boolean;
}

export async function buildZonePreview(
  integrationId: string,
  opts: { refresh?: boolean } = {},
): Promise<ZonePreview | null> {
  const integration = getIntegration(integrationId);
  if (!integration) return null;
  const conn = integration.connectionId ? getConnectionById(integration.connectionId) : undefined;
  const emptyCounts = { adopt: 0, create: 0, cfOnly: 0, tracked: 0, unknown: 0 };

  if (!conn) {
    return {
      rows: [], sync: getSyncState(integrationId, ''),
      cf: { fetchedAt: null, stale: false, error: 'No PowerDNS connection bound' },
      pdns: { fetchedAt: null, stale: false, error: null },
      counts: emptyCounts, connectionMissing: true,
    };
  }
  const serverUrl = normalizeUrl(conn.url);
  const sync = getSyncState(integrationId, serverUrl);
  const tracked = listIntegrationZones(integrationId, serverUrl);

  let pdnsError: string | null = null;
  if (opts.refresh) {
    const ok = await refreshZonesCache(conn.url, conn.apiKey);
    if (!ok) pdnsError = 'PowerDNS zone refresh failed — showing cached zones';
  }
  const pdns = listMasterZones(serverUrl);

  const creds = getIntegrationCredentials(integrationId);
  let cf: CachedCfZones = { zones: null, fetchedAt: null, stale: false, error: null };
  if (creds) {
    cf = await getCachedCfZones(
      `${integrationId}:${integration.config.accountId}`,
      () => listZones(creds, integration.config.accountId),
      { refresh: opts.refresh },
    );
  } else {
    cf = { zones: null, fetchedAt: null, stale: false, error: 'Stored credentials are unreadable' };
  }

  const rows = computePreviewRows(pdns, cf.zones, tracked);
  const counts = { ...emptyCounts };
  for (const r of rows) {
    if (r.previewState === 'adopt') counts.adopt++;
    else if (r.previewState === 'create') counts.create++;
    else if (r.previewState === 'cf-only') counts.cfOnly++;
    else if (r.previewState === 'tracked') counts.tracked++;
    else counts.unknown++;
  }
  return {
    rows, sync,
    cf: { fetchedAt: cf.fetchedAt, stale: cf.stale, error: cf.error },
    pdns: { fetchedAt: Date.now(), stale: Boolean(pdnsError), error: pdnsError },
    counts, connectionMissing: false,
  };
}
