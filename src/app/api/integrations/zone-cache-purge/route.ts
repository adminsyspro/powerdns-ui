import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { findZoneLink } from '@/lib/integrations/sync';
import { getIntegrationCredentials } from '@/lib/integrations/store';
import { purgeZoneCache, CloudflareError } from '@/lib/integrations/cloudflare';
import { canonZone, authorizeZone } from '@/lib/integrations/zone-auth';
import { logActivity, actorFromHeaders } from '@/lib/activity/log';

// POST /api/integrations/zone-cache-purge — purge everything from the
// Cloudflare edge cache of a replicated zone.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const zone = canonZone(String(body.zone ?? ''));
    if (zone === '.') return NextResponse.json({ error: 'zone is required' }, { status: 400 });
    authorizeZone(request, zone, 'write-zone');

    const conn = getConnectionFromRequest(request);
    const found = findZoneLink(conn.url, zone);
    if (!found) return NextResponse.json({ error: 'Zone is not replicated to Cloudflare' }, { status: 404 });
    const creds = getIntegrationCredentials(found.integration.id);
    if (!creds) return NextResponse.json({ error: 'Stored credentials are unreadable' }, { status: 500 });

    try {
      await purgeZoneCache(creds, found.link.remoteZoneId!);
    } catch (e) {
      // Cloudflare 10000: the token lacks the zone permission "Cache Purge: Purge".
      const lacksPermission = e instanceof CloudflareError && e.codes.includes(10000);
      const message = lacksPermission
        ? 'Cloudflare refused the purge (10000 Authentication error) — the API token most likely lacks the zone permission "Cache Purge: Purge"'
        : e instanceof Error ? e.message : 'Cloudflare cache purge failed';
      return NextResponse.json({ error: message }, { status: 502 });
    }
    logActivity({
      ...actorFromHeaders(request),
      action: 'update', resourceType: 'integration',
      resourceId: found.integration.id, resourceName: found.integration.name,
      details: `CF cache purged (everything) for ${zone}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
