import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { findZoneLink } from '@/lib/integrations/sync';
import { getIntegrationCredentials } from '@/lib/integrations/store';
import { getZonesUniqueVisitors } from '@/lib/integrations/cloudflare';
import { canonZone, authorizeZone } from '@/lib/integrations/zone-auth';
import { cacheKey, getCachedAnalytics, setCachedAnalytics, type ZoneAnalyticsPayload } from '@/lib/integrations/analytics-cache';

const MAX_ZONES = 100;

// POST /api/integrations/zones-analytics  body: { zones: string[] }
// Batch unique-visitors for replicated zones. Response is keyed by the EXACT
// requested name (so the client looks up by the same string it sent).
export async function POST(request: NextRequest) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await request.json().catch(() => ({}));
    const raw: unknown[] | null = Array.isArray(body?.zones) ? (body.zones as unknown[]) : null;
    if (!raw) return NextResponse.json({ error: 'zones array required' }, { status: 400 });

    // Parse hygiene: strings, trim, drop empties, dedupe, cap.
    const requested: string[] = Array.from(new Set(
      raw
        .filter((z): z is string => typeof z === 'string')
        .map((z) => z.trim())
        .filter((z): z is string => z.length > 0)
    )).slice(0, MAX_ZONES);

    const conn = getConnectionFromRequest(request);

    const analytics: Record<string, ZoneAnalyticsPayload> = {};
    const missesByIntegration = new Map<string, Array<{ name: string; remoteZoneId: string }>>();

    for (const name of requested) {
      const canonical = canonZone(name);
      try {
        authorizeZone(request, canonical, 'read');
      } catch (e) {
        if (e instanceof AuthzError) continue; // skip unauthorized; never leak
        throw e;
      }
      const found = findZoneLink(conn.url, canonical);
      if (!found || found.link.status === 'error' || !found.link.remoteZoneId) continue;

      const key = cacheKey(found.integration.id, found.link.remoteZoneId);
      const cached = getCachedAnalytics(key);
      if (cached) {
        analytics[name] = cached;
      } else {
        const list = missesByIntegration.get(found.integration.id) ?? [];
        list.push({ name, remoteZoneId: found.link.remoteZoneId });
        missesByIntegration.set(found.integration.id, list);
      }
    }

    // One Cloudflare query per integration with misses.
    for (const [integrationId, misses] of missesByIntegration) {
      const creds = getIntegrationCredentials(integrationId);
      let byId: Map<string, { points: Array<{ date: string; uniques: number }>; total: number }> | null = null;
      if (creds) {
        try {
          byId = await getZonesUniqueVisitors(creds, misses.map((m) => m.remoteZoneId), 30);
        } catch {
          byId = null;
        }
      }
      for (const m of misses) {
        const data = byId?.get(m.remoteZoneId);
        const payload: ZoneAnalyticsPayload = data && data.points.length > 0
          ? { available: true, points: data.points, total: data.total }
          : { available: false };
        setCachedAnalytics(cacheKey(integrationId, m.remoteZoneId), payload);
        analytics[m.name] = payload;
      }
    }

    return NextResponse.json({ analytics });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
