import type {
  Zone,
  ZoneListItem,
  Server,
  ServerConfig,
  ServerStatistic,
  SearchResult,
  RRSet,
} from '@/types/powerdns';

/**
 * Frontend API client that calls our Next.js API routes,
 * passing the active PowerDNS server connection via headers.
 */

interface ConnectionInfo {
  url: string;
  apiKey: string;
  serverId?: string;
}

let activeConnectionGetter: (() => ConnectionInfo | null) | null = null;

export function setConnectionGetter(getter: () => ConnectionInfo | null) {
  activeConnectionGetter = getter;
}

function getHeaders(): HeadersInit {
  const conn = activeConnectionGetter?.();
  if (!conn) return {};
  return {
    'x-pdns-url': conn.url,
    'x-pdns-api-key': conn.apiKey,
    ...(conn.serverId ? { 'x-pdns-server-id': conn.serverId } : {}),
  };
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: string; status: number }> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...getHeaders(),
        ...options.headers,
      },
    });

    if (response.status === 204) {
      return { status: 204 };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/plain')) {
      const text = await response.text();
      return { data: text as unknown as T, status: response.status };
    }

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || data.message || `HTTP ${response.status}`,
        status: response.status,
      };
    }

    return { data, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

// ---- Server ----

export async function fetchServerInfo() {
  return apiRequest<Server>('/api/pdns/servers');
}

export async function fetchStatistics() {
  return apiRequest<ServerStatistic[]>('/api/pdns/statistics');
}

export async function fetchConfig() {
  return apiRequest<ServerConfig[]>('/api/pdns/config');
}

export async function testConnection(url: string, apiKey: string) {
  return apiRequest<{ success: boolean; message: string; server?: { type: string; version: string; id: string } }>(
    '/api/pdns/test-connection',
    {
      method: 'POST',
      body: JSON.stringify({ url, apiKey }),
    }
  );
}

// ---- Zones ----

export async function fetchZones() {
  return apiRequest<ZoneListItem[]>('/api/pdns/zones');
}

export async function fetchZone(zoneId: string) {
  return apiRequest<Zone>(`/api/pdns/zones/${encodeURIComponent(zoneId)}`);
}

export async function createZone(zone: {
  name: string;
  kind: string;
  nameservers: string[];
  masters?: string[];
  account?: string;
  dnssec?: boolean;
  soa_edit_api?: string;
}) {
  return apiRequest<Zone>('/api/pdns/zones', {
    method: 'POST',
    body: JSON.stringify(zone),
  });
}

export async function deleteZone(zoneId: string) {
  return apiRequest<void>(`/api/pdns/zones/${encodeURIComponent(zoneId)}`, {
    method: 'DELETE',
  });
}

export async function updateZoneRecords(zoneId: string, rrsets: RRSet[]) {
  return apiRequest<void>(`/api/pdns/zones/${encodeURIComponent(zoneId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ rrsets }),
  });
}

export async function updateZoneProperties(zoneId: string, properties: Partial<Zone>) {
  return apiRequest<void>(`/api/pdns/zones/${encodeURIComponent(zoneId)}`, {
    method: 'PUT',
    body: JSON.stringify(properties),
  });
}

export async function exportZone(zoneId: string) {
  return apiRequest<string>(`/api/pdns/zones/${encodeURIComponent(zoneId)}/export`);
}

export async function notifyZone(zoneId: string) {
  return apiRequest<void>(`/api/pdns/zones/${encodeURIComponent(zoneId)}/notify`, {
    method: 'PUT',
  });
}

export async function rectifyZone(zoneId: string) {
  return apiRequest<{ result: string }>(`/api/pdns/zones/${encodeURIComponent(zoneId)}/rectify`, {
    method: 'PUT',
  });
}

// ---- Search ----

export async function searchPdns(query: string, max = 100, objectType?: string) {
  const params = new URLSearchParams({ q: query, max: max.toString() });
  if (objectType && objectType !== 'all') {
    params.set('object_type', objectType);
  }
  return apiRequest<SearchResult[]>(`/api/pdns/search?${params}`);
}

// ---- Cache ----

export async function flushCache(domain: string) {
  return apiRequest<{ count: number; result: string }>(
    `/api/pdns/cache?domain=${encodeURIComponent(domain)}`,
    { method: 'PUT' }
  );
}

// ---- Cached Zones (SQLite) ----

export interface PaginatedZonesResponse {
  items: ZoneListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CachedZonesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  kind?: string;
  dnssec?: string;
  sortBy?: string;
  sortOrder?: string;
}

export async function fetchCachedZones(params: CachedZonesParams) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') searchParams.set(k, String(v));
  });
  return apiRequest<PaginatedZonesResponse>(`/api/zones/cached?${searchParams}`);
}

export interface ZoneCacheStats {
  total: number;
  native: number;
  master: number;
  slave: number;
  producer: number;
  consumer: number;
  dnssecEnabled: number;
  lastSyncAt: number;
}

export async function fetchCachedZoneStats() {
  return apiRequest<ZoneCacheStats>('/api/zones/cached/stats');
}

export interface SyncStatus {
  lastSyncAt: number;
  zoneCount: number;
  durationMs: number;
  needsSync?: boolean;
  age?: number;
}

export async function triggerZoneSync() {
  return apiRequest<SyncStatus>('/api/zones/sync', { method: 'POST' });
}

export async function fetchSyncStatus() {
  return apiRequest<SyncStatus>('/api/zones/sync');
}

// ---- DNS Lookup ----

export interface DomainLookup {
  ns: string[];
  expiration: string | null;
  registrar: string | null;
}

export async function fetchDomainLookup(domain: string) {
  return apiRequest<DomainLookup>(`/api/pdns/lookup?domain=${encodeURIComponent(domain)}`);
}

// ---- Change History ----

import type { ChangesetSubmission } from '@/types/powerdns';

export async function saveChangeHistory(submission: ChangesetSubmission) {
  return apiRequest<{ success: boolean }>('/api/zones/history', {
    method: 'POST',
    body: JSON.stringify(submission),
  });
}

export interface PaginatedHistory {
  items: ChangesetSubmission[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RRSetLastChange {
  found: boolean;
  change?: import('@/types/powerdns').PendingChange;
  reason?: string;
  user?: string;
  submittedAt?: number;
}

export async function fetchRRSetLastChange(zoneId: string, rrsetKey: string) {
  return apiRequest<RRSetLastChange>(
    `/api/zones/history/rrset?zoneId=${encodeURIComponent(zoneId)}&rrsetKey=${encodeURIComponent(rrsetKey)}`
  );
}

export async function fetchChangeHistory(params: { zoneId?: string; page?: number; pageSize?: number }) {
  const searchParams = new URLSearchParams();
  if (params.zoneId) searchParams.set('zoneId', params.zoneId);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  return apiRequest<PaginatedHistory>(`/api/zones/history?${searchParams}`);
}
