import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { findZoneLink } from '@/lib/integrations/sync';
import { getIntegrationCredentials } from '@/lib/integrations/store';
import { getZoneDnsAnalytics, type DnsAnalyticsRange } from '@/lib/integrations/cloudflare';
import { canonZone, authorizeZone } from '@/lib/integrations/zone-auth';
import { dnsCacheKey, getCachedDnsAnalytics, setCachedDnsAnalytics, type ZoneDnsAnalyticsPayload } from '@/lib/integrations/dns-analytics-cache';

const WINDOW_SECONDS: Record<DnsAnalyticsRange, number> = {
  '24h': 86_400,
  '7d': 604_800,
  '30d': 2_592_000,
};

// GET /api/integrations/zone-dns-analytics?zone=example.com.&range=24h
// Per-zone Cloudflare DNS analytics for a zone replicated as a secondary.
export async function GET(request: NextRequest) {
  try {
    const zone = canonZone(request.nextUrl.searchParams.get('zone') ?? '');
    if (zone === '.') return NextResponse.json({ error: 'zone parameter required' }, { status: 400 });

    const rangeParam = request.nextUrl.searchParams.get('range') ?? '24h';
    if (rangeParam !== '24h' && rangeParam !== '7d' && rangeParam !== '30d') {
      return NextResponse.json({ error: 'range must be 24h, 7d or 30d' }, { status: 400 });
    }
    const range: DnsAnalyticsRange = rangeParam;

    authorizeZone(request, zone, 'read');

    const conn = getConnectionFromRequest(request);
    const found = findZoneLink(conn.url, zone);
    if (!found || found.link.status === 'error' || !found.link.remoteZoneId) {
      return NextResponse.json({ linked: false });
    }

    const key = dnsCacheKey(found.integration.id, found.link.remoteZoneId, range);
    const cached = getCachedDnsAnalytics(key);
    if (cached) return NextResponse.json({ linked: true, ...cached });

    const creds = getIntegrationCredentials(found.integration.id);
    let payload: ZoneDnsAnalyticsPayload;
    if (!creds) {
      payload = { available: false };
    } else {
      try {
        const data = await getZoneDnsAnalytics(creds, found.link.remoteZoneId, range);
        payload = data
          ? {
              available: true,
              range,
              series: data.series,
              totalQueries: data.totalQueries,
              avgQps: data.totalQueries / WINDOW_SECONDS[range],
              avgProcessingMs: data.avgProcessingMs,
              breakdowns: data.breakdowns,
            }
          : { available: false };
      } catch {
        payload = { available: false };
      }
    }
    setCachedDnsAnalytics(key, payload);
    return NextResponse.json({ linked: true, ...payload });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
