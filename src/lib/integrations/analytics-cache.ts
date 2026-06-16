// Shared in-memory TTL cache for Cloudflare zone analytics, used by both the
// single-zone and batch endpoints. Stores ONLY the analytics payload (never the
// `linked` routing flag); only linked zones are ever cached. Keyed by
// `${integrationId}:${remoteZoneId}` so the two endpoints share entries.

export interface ZoneAnalyticsPayload {
  available: boolean;
  points?: Array<{ date: string; uniques: number }>;
  total?: number;
}

const POSITIVE_TTL = 30 * 60 * 1000; // 30 min
const NEGATIVE_TTL = 5 * 60 * 1000;  // 5 min
const cache = new Map<string, { fetchedAt: number; payload: ZoneAnalyticsPayload }>();

export function cacheKey(integrationId: string, remoteZoneId: string): string {
  return `${integrationId}:${remoteZoneId}`;
}

export function getCachedAnalytics(key: string): ZoneAnalyticsPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.payload.available ? POSITIVE_TTL : NEGATIVE_TTL;
  if (Date.now() - hit.fetchedAt >= ttl) return null;
  return hit.payload;
}

export function setCachedAnalytics(key: string, payload: ZoneAnalyticsPayload): void {
  cache.set(key, { fetchedAt: Date.now(), payload });
}
