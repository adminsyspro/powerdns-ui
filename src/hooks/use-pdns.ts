'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useServerConnectionStore } from '@/stores';
import { setConnectionGetter } from '@/lib/api';
import * as api from '@/lib/api';
import type {
  Zone,
  ZoneListItem,
  Server,
  ServerStatistic,
  ServerConfig,
  SearchResult,
} from '@/types/powerdns';

// ---- Initialize connection getter from store ----

function useConnectionSync() {
  const { activeConnection } = useServerConnectionStore();

  useEffect(() => {
    setConnectionGetter(() => {
      if (!activeConnection) return null;
      return {
        url: activeConnection.url,
        apiKey: activeConnection.apiKey,
      };
    });
  }, [activeConnection]);

  return activeConnection;
}

// ---- Generic fetch hook ----

interface FetchState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

function useFetch<T>(
  fetcher: () => Promise<{ data?: T; error?: string; status: number }>,
  deps: unknown[] = [],
  enabled = true
) {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    const result = await fetcher();
    if (!mountedRef.current) return;
    if (result.error) {
      setState({ data: null, error: result.error, isLoading: false });
    } else {
      setState({ data: result.data ?? null, error: null, isLoading: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    refetch();
    return () => { mountedRef.current = false; };
  }, [refetch]);

  return { ...state, refetch };
}

// ---- Hooks ----

/** Fetch the list of zones directly from PowerDNS (use for small datasets or one-off) */
export function useZones() {
  const conn = useConnectionSync();
  return useFetch<ZoneListItem[]>(
    () => api.fetchZones(),
    [conn?.id],
    !!conn
  );
}

/** Fetch paginated zones from the SQLite cache (fast, for 3000+ zones) */
export function useCachedZones(params: api.CachedZonesParams) {
  const conn = useConnectionSync();
  return useFetch<api.PaginatedZonesResponse>(
    () => api.fetchCachedZones(params),
    [conn?.id, params.page, params.pageSize, params.search, params.kind, params.dnssec, params.sortBy, params.sortOrder],
    !!conn
  );
}

/** Fetch cached zone statistics for the dashboard */
export function useCachedZoneStats() {
  const conn = useConnectionSync();
  return useFetch<api.ZoneCacheStats>(
    () => api.fetchCachedZoneStats(),
    [conn?.id],
    !!conn
  );
}

/** Fetch a single zone with all its records (direct from PowerDNS) */
export function useZone(zoneId: string | null) {
  const conn = useConnectionSync();
  return useFetch<Zone>(
    () => api.fetchZone(zoneId!),
    [conn?.id, zoneId],
    !!conn && !!zoneId
  );
}

/** Fetch server info */
export function useServerInfo() {
  const conn = useConnectionSync();
  return useFetch<Server>(
    () => api.fetchServerInfo(),
    [conn?.id],
    !!conn
  );
}

/** Fetch server statistics */
export function useStatistics() {
  const conn = useConnectionSync();
  return useFetch<ServerStatistic[]>(
    () => api.fetchStatistics(),
    [conn?.id],
    !!conn
  );
}

/** Fetch server configuration */
export function useConfig() {
  const conn = useConnectionSync();
  return useFetch<ServerConfig[]>(
    () => api.fetchConfig(),
    [conn?.id],
    !!conn
  );
}

/** Search across zones, records, and comments */
export function useSearch(query: string, maxResults = 100) {
  const conn = useConnectionSync();
  return useFetch<SearchResult[]>(
    () => api.searchPdns(query, maxResults),
    [conn?.id, query, maxResults],
    !!conn && query.length >= 1
  );
}

/** Convert statistics array to a key-value map */
export function statsToMap(stats: ServerStatistic[] | null): Record<string, string> {
  if (!stats) return {};
  const map: Record<string, string> = {};
  for (const stat of stats) {
    map[stat.name] = stat.value;
  }
  return map;
}

// ---- Sync ----

export function useZoneSync() {
  const conn = useConnectionSync();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<api.SyncStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!conn) return;
    const result = await api.fetchSyncStatus();
    if (result.data) setSyncStatus(result.data);
  }, [conn?.id]);

  const sync = useCallback(async () => {
    if (!conn || isSyncing) return;
    setIsSyncing(true);
    const result = await api.triggerZoneSync();
    setIsSyncing(false);
    if (result.data) {
      setSyncStatus(result.data);
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, isSyncing]);

  // Fetch status on mount
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return { sync, isSyncing, syncStatus, refreshStatus: fetchStatus };
}

/** Auto-sync poller — runs in dashboard layout */
export function useSyncPoller(intervalMs = 300_000) {
  const conn = useConnectionSync();

  useEffect(() => {
    if (!conn) return;

    const check = async () => {
      const status = await api.fetchSyncStatus();
      if (status.data) {
        const age = Date.now() - status.data.lastSyncAt;
        if (age > intervalMs || status.data.needsSync) {
          await api.triggerZoneSync();
        }
      }
    };

    check(); // sync on mount
    const timer = setInterval(check, 60_000); // check every minute
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, intervalMs]);
}
