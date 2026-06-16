// In-memory bounded TTL cache for the single-zone Cloudflare traffic payload
// (header sparklines). Separate from analytics-cache.ts (which the zones-list
// batch uses) so the richer payload never collides with the batch's uniques-only
// entries under the same key. Stores only the payload, never `linked`.
import type { ZoneTrafficData } from './cloudflare';

export interface ZoneTrafficPayload {
  available: boolean;
  points?: ZoneTrafficData['points'];
  totals?: ZoneTrafficData['totals'];
}

const POSITIVE_TTL = 30 * 60 * 1000; // 30 min
const NEGATIVE_TTL = 5 * 60 * 1000;  // 5 min
const MAX_ENTRIES = 200;
const cache = new Map<string, { fetchedAt: number; payload: ZoneTrafficPayload }>();

export function trafficCacheKey(integrationId: string, remoteZoneId: string): string {
  return `${integrationId}:${remoteZoneId}`;
}

export function getCachedTraffic(key: string): ZoneTrafficPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.payload.available ? POSITIVE_TTL : NEGATIVE_TTL;
  if (Date.now() - hit.fetchedAt >= ttl) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

export function setCachedTraffic(key: string, payload: ZoneTrafficPayload): void {
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { fetchedAt: Date.now(), payload });
}
