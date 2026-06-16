// In-memory TTL cache for per-zone Cloudflare DNS analytics. Mirrors
// analytics-cache.ts but is keyed by range and is BOUNDED (payloads are larger
// and multiply by 3 ranges). Stores only the analytics payload (never `linked`).
import type { ZoneDnsAnalyticsData, DnsAnalyticsRange } from './cloudflare';

export interface ZoneDnsAnalyticsPayload {
  available: boolean;
  range?: DnsAnalyticsRange;
  series?: ZoneDnsAnalyticsData['series'];
  totalQueries?: number;
  avgQps?: number;
  avgProcessingMs?: number | null;
  breakdowns?: ZoneDnsAnalyticsData['breakdowns'];
}

const POSITIVE_TTL = 5 * 60 * 1000; // 5 min
const NEGATIVE_TTL = 5 * 60 * 1000; // 5 min
const MAX_ENTRIES = 200;
const cache = new Map<string, { fetchedAt: number; payload: ZoneDnsAnalyticsPayload }>();

export function dnsCacheKey(integrationId: string, remoteZoneId: string, range: DnsAnalyticsRange): string {
  return `${integrationId}:${remoteZoneId}:${range}`;
}

export function getCachedDnsAnalytics(key: string): ZoneDnsAnalyticsPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.payload.available ? POSITIVE_TTL : NEGATIVE_TTL;
  if (Date.now() - hit.fetchedAt >= ttl) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

export function setCachedDnsAnalytics(key: string, payload: ZoneDnsAnalyticsPayload): void {
  // Evict the oldest entry when at capacity (Map preserves insertion order).
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { fetchedAt: Date.now(), payload });
}
