import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { findZoneLink } from '@/lib/integrations/sync';
import { getIntegrationCredentials } from '@/lib/integrations/store';
import { getZoneUniqueVisitors } from '@/lib/integrations/cloudflare';
import { canonZone, authorizeZone } from '@/lib/integrations/zone-auth';

interface AnalyticsResponse {
  linked: boolean;
  available?: boolean;
  points?: Array<{ date: string; uniques: number }>;
  total?: number;
}

const POSITIVE_TTL = 30 * 60 * 1000; // 30 min
const NEGATIVE_TTL = 5 * 60 * 1000;  // 5 min
const cache = new Map<string, { fetchedAt: number; payload: AnalyticsResponse }>();

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
      return NextResponse.json({ linked: false } as AnalyticsResponse);
    }

    const cacheKey = `${found.integration.id}:${found.link.remoteZoneId}`;
    const hit = cache.get(cacheKey);
    if (hit) {
      const ttl = hit.payload.available ? POSITIVE_TTL : NEGATIVE_TTL;
      if (Date.now() - hit.fetchedAt < ttl) return NextResponse.json(hit.payload);
    }

    const creds = getIntegrationCredentials(found.integration.id);
    let payload: AnalyticsResponse;
    if (!creds) {
      payload = { linked: true, available: false };
    } else {
      try {
        const data = await getZoneUniqueVisitors(creds, found.link.remoteZoneId, 30);
        payload = data
          ? { linked: true, available: true, points: data.points, total: data.total }
          : { linked: true, available: false };
      } catch {
        payload = { linked: true, available: false };
      }
    }
    cache.set(cacheKey, { fetchedAt: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
