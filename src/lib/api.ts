import type {
  Zone,
  ZoneListItem,
  Server,
  ServerConfig,
  ServerStatistic,
  SearchResult,
  RRSet,
  ServerConnection,
  CryptoKey,
  RRSetHistoryEntry,
} from '@/types/powerdns';
import type { ImportPreview } from '@/lib/bind/types';
import type { NameserverPool } from '@/lib/ns-pools';
import type { NsAuditResults, NsAuditScanState } from '@/lib/ns-audit';
import type { IntegrationConfig, IntegrationRow, IntegrationZoneRow } from '@/lib/integrations/types';
import type { IntegrationSyncState } from '@/lib/integrations/sync';
import type { ZonePreview } from '@/lib/integrations/preview';
import type { AcmeAccount, AcmeAccountInput, AcmeAccountPatch, Certificate, CertEvent, InternalCaStatus } from '@/lib/certs/types';
import type { ActivityEntry } from '@/lib/activity/log';

export type NsAuditResponse = NsAuditResults & { scan: NsAuditScanState };

/**
 * Frontend API client that calls our Next.js API routes,
 * passing the active PowerDNS server connection via headers.
 */

interface ConnectionInfo {
  // Which stored connection to use. The server resolves the url + API key from
  // this id (see pdns-proxy.ts); the key never travels to/through the client.
  connectionId?: string;
  serverId?: string;
}

let activeConnectionGetter: (() => ConnectionInfo | null) | null = null;

export function setConnectionGetter(getter: () => ConnectionInfo | null) {
  activeConnectionGetter = getter;
}

function getHeaders(override?: ConnectionInfo | null): HeadersInit {
  const conn = override ?? activeConnectionGetter?.();
  if (!conn) return {};
  return {
    ...(conn.connectionId ? { 'x-pdns-connection-id': conn.connectionId } : {}),
    ...(conn.serverId ? { 'x-pdns-server-id': conn.serverId } : {}),
  };
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
  // Optional per-call connection override: targets a specific stored
  // connection (e.g. a non-active server card) instead of the active one.
  conn?: ConnectionInfo
): Promise<{ data?: T; error?: string; status: number }> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...getHeaders(conn),
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

// ---- Server Connections (SQLite-backed) ----

export async function fetchConnections() {
  return apiRequest<ServerConnection[]>('/api/connections');
}

export async function createConnection(connection: Omit<ServerConnection, 'id'>) {
  return apiRequest<ServerConnection>('/api/connections', {
    method: 'POST',
    body: JSON.stringify(connection),
  });
}

export async function updateConnectionApi(id: string, connection: Partial<ServerConnection>) {
  return apiRequest<ServerConnection>(`/api/connections/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(connection),
  });
}

export async function deleteConnection(id: string) {
  return apiRequest<{ success: boolean }>(`/api/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ---- Server ----

export async function fetchServerInfo(connectionId?: string, serverId?: string) {
  return apiRequest<Server>('/api/pdns/servers', {}, connectionId ? { connectionId, serverId } : undefined);
}

export async function fetchStatistics(connectionId?: string, serverId?: string) {
  return apiRequest<ServerStatistic[]>('/api/pdns/statistics', {}, connectionId ? { connectionId, serverId } : undefined);
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

// ---- Application Settings ----

export async function fetchNameserverPools() {
  return apiRequest<{ pools: NameserverPool[] }>('/api/settings/ns-pools');
}

export async function saveNameserverPools(pools: NameserverPool[]) {
  return apiRequest<{ pools: NameserverPool[] }>('/api/settings/ns-pools', {
    method: 'PUT',
    body: JSON.stringify({ pools }),
  });
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

// ---- BIND Import ----

export async function parseBindZone(content: string, origin?: string) {
  return apiRequest<ImportPreview>('/api/pdns/zones/import-bind/parse', {
    method: 'POST',
    body: JSON.stringify({ content, origin }),
  });
}

export async function createZoneFromBind(input: {
  content: string;
  name: string;
  kind: string;
  nameservers: string[];
  masters?: string[];
  account?: string;
  dnssec?: boolean;
  soa_edit_api?: string;
}) {
  return apiRequest<Zone>('/api/pdns/zones/import-bind/create', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---- Zone Records (paginated) ----

export interface ZoneRecordsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface FlatRecord {
  name: string;
  type: string;
  ttl: number;
  content: string;
  disabled: boolean;
  comments: Array<{ content: string; account: string; modified_at: number }>;
}

export interface PaginatedRecordsResponse {
  items: FlatRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  typeStats: Record<string, number>;
  rrsets: import('@/types/powerdns').RRSet[];
}

export async function fetchZoneRecords(zoneId: string, params: ZoneRecordsParams = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') searchParams.set(k, String(v));
  });
  return apiRequest<PaginatedRecordsResponse>(
    `/api/pdns/zones/${encodeURIComponent(zoneId)}/records?${searchParams}`
  );
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

// ---- DNSSEC / Cryptokeys ----

export async function fetchCryptokeys(zoneId: string) {
  return apiRequest<CryptoKey[]>(`/api/pdns/zones/${encodeURIComponent(zoneId)}/cryptokeys`);
}

export async function createCryptokey(
  zoneId: string,
  key: { keytype: 'csk' | 'ksk' | 'zsk'; active: boolean; algorithm?: string; bits?: number }
) {
  return apiRequest<CryptoKey>(`/api/pdns/zones/${encodeURIComponent(zoneId)}/cryptokeys`, {
    method: 'POST',
    body: JSON.stringify(key),
  });
}

export async function updateCryptokey(zoneId: string, keyId: number, key: Partial<CryptoKey>) {
  return apiRequest<void>(
    `/api/pdns/zones/${encodeURIComponent(zoneId)}/cryptokeys/${keyId}`,
    { method: 'PUT', body: JSON.stringify(key) }
  );
}

export async function deleteCryptokey(zoneId: string, keyId: number) {
  return apiRequest<void>(
    `/api/pdns/zones/${encodeURIComponent(zoneId)}/cryptokeys/${keyId}`,
    { method: 'DELETE' }
  );
}

// ---- Zone metadata (transfer-related kinds only, see the API route) ----

export type ZoneMetadataKind = 'ALLOW-AXFR-FROM' | 'ALSO-NOTIFY';

export async function fetchZoneMetadata(zoneId: string, kind: ZoneMetadataKind) {
  return apiRequest<{ kind: string; metadata: string[] }>(
    `/api/pdns/zones/${encodeURIComponent(zoneId)}/metadata/${kind}`
  );
}

export async function setZoneMetadata(zoneId: string, kind: ZoneMetadataKind, metadata: string[]) {
  return apiRequest<{ kind: string; metadata: string[] }>(
    `/api/pdns/zones/${encodeURIComponent(zoneId)}/metadata/${kind}`,
    { method: 'PUT', body: JSON.stringify({ kind, metadata }) }
  );
}

// ---- Integrations (Cloudflare secondary DNS, …) ----

export async function fetchIntegrations() {
  return apiRequest<IntegrationRow[]>('/api/integrations');
}

export async function createIntegrationApi(input: {
  provider: 'cloudflare';
  name: string;
  apiToken: string;
  tsigSecret?: string;
  config: Partial<IntegrationConfig>;
  connectionId: string;
}) {
  return apiRequest<IntegrationRow>('/api/integrations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateIntegrationApi(
  id: string,
  patch: { name?: string; apiToken?: string; tsigSecret?: string; config?: Partial<IntegrationConfig>; active?: boolean; connectionId?: string }
) {
  return apiRequest<IntegrationRow>(`/api/integrations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteIntegrationApi(id: string) {
  return apiRequest<void>(`/api/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchIntegrationDetail(id: string) {
  return apiRequest<{ integration: IntegrationRow; connectionMissing: boolean; zones: IntegrationZoneRow[]; sync: IntegrationSyncState }>(
    `/api/integrations/${encodeURIComponent(id)}`
  );
}

export async function testIntegration(id: string) {
  return apiRequest<{ ok: boolean; remoteZones?: number; error?: string }>(
    `/api/integrations/${encodeURIComponent(id)}/test`,
    { method: 'POST' }
  );
}

export async function startIntegrationSync(id: string) {
  return apiRequest<{ sync: IntegrationSyncState }>(`/api/integrations/${encodeURIComponent(id)}/sync`, {
    method: 'POST',
  });
}

export async function forceIntegrationAxfr(id: string, zoneName: string) {
  return apiRequest<{ ok: boolean }>(`/api/integrations/${encodeURIComponent(id)}/force-axfr`, {
    method: 'POST',
    body: JSON.stringify({ zoneName }),
  });
}

export async function setIntegrationZoneCustomNsSet(id: string, zoneName: string, nsSet: number | null) {
  return apiRequest<{ ok: boolean }>(`/api/integrations/${encodeURIComponent(id)}/custom-ns-set`, {
    method: 'POST',
    body: JSON.stringify({ zoneName, nsSet }),
  });
}

export async function purgeIntegrationOrphan(id: string, zoneName: string) {
  return apiRequest<{ ok: boolean }>(`/api/integrations/${encodeURIComponent(id)}/purge-orphan`, {
    method: 'POST',
    body: JSON.stringify({ zoneName }),
  });
}

export interface IntegrationStats {
  totals: { scope: number; ok: number; error: number; pending: number; orphan: number; lastActivity: number | null };
  integrations: Array<{
    id: string;
    name: string;
    active: boolean;
    scopeCount: number;
    counts: Record<string, number>;
    lastActivity: number | null;
  }>;
}

export async function fetchIntegrationStats() {
  return apiRequest<IntegrationStats>('/api/integrations/stats');
}

export async function fetchCustomNsSets(input: { accountId: string; apiToken?: string; integrationId?: string }) {
  return apiRequest<{ sets: Array<{ set: number; nameservers: Array<{ host: string; ip: string | null }> }> }>(
    '/api/integrations/custom-ns-sets',
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export interface ZoneProxyRecord {
  name: string;
  type: string;
  proxied: boolean;
  proxiable: boolean;
}

export async function fetchZoneProxyState(zone: string) {
  return apiRequest<{ linked: boolean; integrationId?: string; integrationName?: string; records: ZoneProxyRecord[]; error?: string }>(
    `/api/integrations/zone-proxy?zone=${encodeURIComponent(zone)}`
  );
}

export async function setZoneRecordProxied(zone: string, recordName: string, type: string, proxied: boolean) {
  return apiRequest<{ ok: boolean; updated: number; proxied: boolean }>(
    '/api/integrations/zone-proxy',
    { method: 'PUT', body: JSON.stringify({ zone, recordName, type, proxied }) }
  );
}

// Canonical names of zones replicated to a provider (Cloudflare secondary) on
// the current connection — used to flag those zones in lists and the switcher.
export async function fetchReplicatedZoneNames() {
  return apiRequest<{ zones: string[] }>('/api/integrations/replicated-zones');
}

export async function fetchIntegrationPreview(id: string, refresh = false) {
  return apiRequest<ZonePreview>(
    `/api/integrations/${encodeURIComponent(id)}/preview${refresh ? '?refresh=1' : ''}`
  );
}

export async function syncIntegrationZone(id: string, zoneName: string) {
  return apiRequest<{ row: IntegrationZoneRow }>(`/api/integrations/${encodeURIComponent(id)}/sync-zone`, {
    method: 'POST',
    body: JSON.stringify({ zoneName }),
  });
}

export interface ZoneTrafficPoint {
  date: string;
  uniques: number;
  requests: number;
  cachedRequests: number;
  bytes: number;
  cachedBytes: number;
}

export interface ZoneTraffic {
  linked: boolean;
  available?: boolean;
  points?: ZoneTrafficPoint[];
  totals?: { uniques: number; requests: number; cachedRequests: number; bytes: number; cachedBytes: number };
}

// Five-metric Cloudflare traffic (30d daily) for one replicated zone — drives the
// zone-header sparkline strip. The endpoint self-reports linked/available state.
export async function fetchZoneTraffic(zone: string) {
  return apiRequest<ZoneTraffic>(`/api/integrations/zone-traffic?zone=${encodeURIComponent(zone)}`);
}

export interface ZonesAnalytics {
  analytics: Record<string, { available: boolean; points?: Array<{ date: string; uniques: number }>; total?: number }>;
}

// Batch Cloudflare unique-visitors for many zones (the replicated rows of a
// zones-table page). POST avoids URL-length limits on long zone lists.
export async function fetchZonesAnalytics(zones: string[]) {
  return apiRequest<ZonesAnalytics>('/api/integrations/zones-analytics', {
    method: 'POST',
    body: JSON.stringify({ zones }),
  });
}

export type DnsAnalyticsRange = '24h' | '7d' | '30d';

export interface DnsBreakdownItem {
  label: string;
  sublabel?: string;
  count: number;
}

export interface ZoneDnsAnalytics {
  linked: boolean;
  available?: boolean;
  range?: DnsAnalyticsRange;
  series?: Array<{ ts: string; count: number }>;
  totalQueries?: number;
  avgQps?: number;
  avgProcessingMs?: number | null;
  breakdowns?: {
    queryName: DnsBreakdownItem[];
    dnsRecord: DnsBreakdownItem[];
    responseCode: DnsBreakdownItem[];
    recordType: DnsBreakdownItem[];
    dataCenter: DnsBreakdownItem[];
    sourceIp: DnsBreakdownItem[];
    destinationIp: DnsBreakdownItem[];
    transport: DnsBreakdownItem[];
    ipVersion: DnsBreakdownItem[];
  };
}

// Cloudflare DNS analytics for one replicated zone over the given range. The
// endpoint self-reports linked/available state; the modal renders "No data" when
// unavailable.
export async function fetchZoneDnsAnalytics(zone: string, range: DnsAnalyticsRange) {
  return apiRequest<ZoneDnsAnalytics>(
    `/api/integrations/zone-dns-analytics?zone=${encodeURIComponent(zone)}&range=${range}`
  );
}

// --- SSL certificates: ACME accounts ---
export async function fetchAcmeAccounts() {
  return apiRequest<AcmeAccount[]>('/api/certs/accounts');
}

export async function createAcmeAccountApi(input: AcmeAccountInput) {
  return apiRequest<AcmeAccount>('/api/certs/accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAcmeAccountApi(id: string, patch: AcmeAccountPatch) {
  return apiRequest<AcmeAccount>(`/api/certs/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteAcmeAccountApi(id: string) {
  return apiRequest<void>(`/api/certs/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- SSL certificates: internal CA (bundled step-ca) ---
export function fetchInternalCaStatus() {
  return apiRequest<InternalCaStatus>('/api/certs/internal-ca');
}

export function setupInternalCaApi() {
  return apiRequest<AcmeAccount>('/api/certs/internal-ca/setup', { method: 'POST' });
}

// --- SSL certificates: certificates ---
export async function fetchCertificates() {
  return apiRequest<Certificate[]>('/api/certs');
}

export async function createCertificateApi(input: {
  name: string;
  acmeAccountId: string;
  connectionId: string;
  sans: string[];
  keyType?: 'ecdsa' | 'rsa';
  autoRenew?: boolean;
  renewBeforeDays?: number;
  category?: string;
  comment?: string;
}) {
  return apiRequest<Certificate>('/api/certs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCertificateApi(
  id: string,
  patch: {
    autoRenew?: boolean;
    renewBeforeDays?: number;
    keyDownloadEnabled?: boolean;
    category?: string | null;
    comment?: string | null;
  }
) {
  return apiRequest<Certificate>(`/api/certs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCertificateApi(id: string) {
  return apiRequest<void>(`/api/certs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function issueCertificateApi(id: string) {
  return apiRequest<{ jobId: string }>(`/api/certs/${encodeURIComponent(id)}/issue`, { method: 'POST' });
}

export async function fetchCertEvents(id: string) {
  return apiRequest<CertEvent[]>(`/api/certs/${encodeURIComponent(id)}/events`);
}

export function fetchCertificate(id: string) {
  return apiRequest<Certificate>(`/api/certs/${id}`);
}

export function fetchAcmeAccount(id: string) {
  return apiRequest<AcmeAccount>(`/api/certs/accounts/${id}`);
}

export function registerAcmeAccountApi(id: string) {
  return apiRequest<AcmeAccount>(`/api/certs/accounts/${id}/register`, { method: 'POST' });
}

/** Direct URL for the public fullchain (used by an <a download> link). */
export function certFullchainDownloadUrl(id: string): string {
  return `/api/certs/${id}/download`;
}

/** Audited private-key bundle download; returns the PEM text. */
export function downloadCertBundle(id: string) {
  return apiRequest<string>(`/api/certs/${id}/download`, { method: 'POST' });
}

// ---- NS compliance audit ----

export async function fetchNsAudit() {
  return apiRequest<NsAuditResponse>('/api/zones/ns-audit');
}

export async function startNsAuditScan() {
  return apiRequest<{ scan: NsAuditScanState }>('/api/zones/ns-audit/scan', { method: 'POST' });
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
  forwardTotal: number;
  reverseTotal: number;
}

export interface CachedZonesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  kind?: string;
  dnssec?: string;
  scope?: 'forward' | 'reverse';
  sortBy?: string;
  sortOrder?: string;
  replicated?: boolean;
}

export async function fetchCachedZones(params: CachedZonesParams) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') searchParams.set(k, String(v));
  });
  return apiRequest<PaginatedZonesResponse>(`/api/zones/cached?${searchParams}`);
}

/** Cached-zone typeahead scoped to a specific connection (not the active one). */
export function fetchZonesForConnection(connectionId: string, search: string) {
  const qs = new URLSearchParams({ page: '1', pageSize: '20', search });
  return apiRequest<PaginatedZonesResponse>(`/api/zones/cached?${qs}`, {}, { connectionId });
}

/**
 * Full zone (with rrsets) scoped to a specific connection. Uses the
 * connection-aware `/api/pdns/zones/[id]` route (which always fetches with
 * `?rrsets=true` server-side) — NOT the legacy env-pinned `/api/zones/[id]`
 * route, which ignores the `x-pdns-connection-id` header entirely.
 */
export function fetchZoneForConnection(connectionId: string, zoneId: string) {
  return apiRequest<Zone>(`/api/pdns/zones/${encodeURIComponent(zoneId)}`, {}, { connectionId });
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

// ---- Groups ----

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  zoneCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchGroups() {
  return apiRequest<GroupSummary[]>('/api/groups');
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

export async function fetchZoneChangeCounts(zoneId: string) {
  return apiRequest<{ counts: Record<string, number> }>(
    `/api/zones/history/counts?zoneId=${encodeURIComponent(zoneId)}`
  );
}

export async function fetchRRSetHistory(zoneId: string, rrsetKey: string) {
  return apiRequest<{ items: RRSetHistoryEntry[]; hasMore: boolean }>(
    `/api/zones/history/rrset/list?zoneId=${encodeURIComponent(zoneId)}&rrsetKey=${encodeURIComponent(rrsetKey)}`
  );
}

export async function fetchChangeHistory(params: { zoneId?: string; page?: number; pageSize?: number }) {
  const searchParams = new URLSearchParams();
  if (params.zoneId) searchParams.set('zoneId', params.zoneId);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  return apiRequest<PaginatedHistory>(`/api/zones/history?${searchParams}`);
}

// ---- Activity log ----

export interface PaginatedActivity {
  items: ActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function fetchActivity(params: { page?: number; pageSize?: number; action?: string; resourceType?: string; actor?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  return apiRequest<PaginatedActivity>(`/api/activity?${qs}`);
}
