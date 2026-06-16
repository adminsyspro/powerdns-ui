import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { findZoneLink } from '@/lib/integrations/sync';
import { getIntegrationCredentials } from '@/lib/integrations/store';
import { getZoneUniqueVisitors } from '@/lib/integrations/cloudflare';
import { canonZone, authorizeZone } from '@/lib/integrations/zone-auth';
import { cacheKey, getCachedAnalytics, setCachedAnalytics, type ZoneAnalyticsPayload } from '@/lib/integrations/analytics-cache';

// GET /api/integrations/zone-analytics?zone=example.com.
// Unique-visitors (HTTP, 30d daily) for a zone replicated to Cloudflare.
export async function GET(request: NextRequest) {
  try {
    const zone = canonZone(request.nextUrl.searchParams.get('zone') ?? '');
    if (zone === '.') return NextResponse.json({ error: 'zone parameter required' }, { status: 400 });
    authorizeZone(request, zone, 'read');

    const conn = getConnectionFromRequest(request);
    const found = findZoneLink(conn.url, zone);
    if (!found || found.link.status === 'error' || !found.link.remoteZoneId) {
      return NextResponse.json({ linked: false });
    }

    const key = cacheKey(found.integration.id, found.link.remoteZoneId);
    const cached = getCachedAnalytics(key);
    if (cached) return NextResponse.json({ linked: true, ...cached });

    const creds = getIntegrationCredentials(found.integration.id);
    let payload: ZoneAnalyticsPayload;
    if (!creds) {
      payload = { available: false };
    } else {
      try {
        const data = await getZoneUniqueVisitors(creds, found.link.remoteZoneId, 30);
        payload = data
          ? { available: true, points: data.points, total: data.total }
          : { available: false };
      } catch {
        payload = { available: false };
      }
    }
    setCachedAnalytics(key, payload);
    return NextResponse.json({ linked: true, ...payload });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
