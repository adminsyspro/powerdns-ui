import type { CfZone } from './cloudflare';
import type { IntegrationZoneRow, IntegrationZoneStatus } from './types';

export type ZonePreviewState = 'tracked' | 'adopt' | 'create' | 'cf-only' | 'unknown';

export interface ZonePreviewRow {
  zoneName: string;
  previewState: ZonePreviewState;
  inPdnsScope: boolean;
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
    const inPdnsScope = Boolean(pdns);
    const cfPresent = Boolean(cf);

    let previewState: ZonePreviewState;
    if (tr) previewState = 'tracked';
    else if (inPdnsScope && cfByKey === null) previewState = 'unknown';
    else if (inPdnsScope && cfPresent) previewState = 'adopt';
    else if (inPdnsScope) previewState = 'create';
    else previewState = 'cf-only';

    const status = tr?.status;
    const syncable = inPdnsScope && status !== 'provisioning';

    rows.push({
      zoneName: pdns?.name ?? tr?.zoneName ?? cf?.name ?? key,
      previewState,
      inPdnsScope,
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

  if (!opts.refresh && entry && entry.zones && now - entry.fetchedAt < ttl) {
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
    cfCache.set(key, { fetchedAt: Date.now(), zones, pending: null });
    return { zones, fetchedAt: Date.now(), stale: false, error: null };
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
