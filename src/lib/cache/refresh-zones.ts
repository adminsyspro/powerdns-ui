import { fetchZonesFromPdns } from '@/lib/pdns-proxy';
import { syncZonesToCache } from '@/lib/cache/zones';

/**
 * Re-fetch a PowerDNS server's zones into the local cache. Shared by the
 * reconcile worker and the integrations preview. Returns false on failure
 * (caller decides whether to proceed with the stale cache).
 */
export async function refreshZonesCache(serverUrl: string, apiKey: string): Promise<boolean> {
  try {
    const zones = await fetchZonesFromPdns(serverUrl, apiKey);
    syncZonesToCache(serverUrl, zones as Parameters<typeof syncZonesToCache>[1]);
    return true;
  } catch (e) {
    console.warn(`[refresh-zones] cache refresh failed for ${serverUrl}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
