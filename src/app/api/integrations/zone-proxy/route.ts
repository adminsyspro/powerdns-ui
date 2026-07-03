import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { findZoneLink } from '@/lib/integrations/sync';
import { getIntegrationCredentials } from '@/lib/integrations/store';
import { listDnsRecords, setRecordProxied } from '@/lib/integrations/cloudflare';
import { canonZone, authorizeZone } from '@/lib/integrations/zone-auth';
import { logActivity, actorFromHeaders } from '@/lib/activity/log';

// Cloudflare can only proxy these record types.
const PROXYABLE_TYPES = new Set(['A', 'AAAA', 'CNAME']);

// GET /api/integrations/zone-proxy?zone=example.com.
// Returns whether the zone is replicated to Cloudflare and, if so, the
// proxied (orange cloud) state of each proxyable record.
export async function GET(request: NextRequest) {
  try {
    const zone = canonZone(request.nextUrl.searchParams.get('zone') ?? '');
    if (zone === '.') return NextResponse.json({ error: 'zone parameter required' }, { status: 400 });
    authorizeZone(request, zone, 'read');

    const conn = getConnectionFromRequest(request);
    const found = findZoneLink(conn.url, zone);
    if (!found) return NextResponse.json({ linked: false, records: [] });

    const creds = getIntegrationCredentials(found.integration.id);
    if (!creds) return NextResponse.json({ linked: false, records: [] });

    try {
      const records = await listDnsRecords(creds, found.link.remoteZoneId!);
      return NextResponse.json({
        linked: true,
        integrationId: found.integration.id,
        integrationName: found.integration.name,
        records: records
          .filter((r) => PROXYABLE_TYPES.has(r.type))
          .map((r) => ({ name: r.name, type: r.type, proxied: r.proxied, proxiable: r.proxiable })),
      });
    } catch (e) {
      return NextResponse.json(
        { linked: true, integrationId: found.integration.id, integrationName: found.integration.name, records: [], error: e instanceof Error ? e.message : 'Cloudflare lookup failed' },
        { status: 502 }
      );
    }
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/integrations/zone-proxy — toggle the orange cloud on one rrset.
// Applies to every Cloudflare record matching name+type (an rrset can map to
// several provider records).
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const zone = canonZone(String(body.zone ?? ''));
    const recordName = String(body.recordName ?? '').toLowerCase().replace(/\.$/, '');
    const type = String(body.type ?? '').toUpperCase();
    const proxied = body.proxied === true;
    if (zone === '.' || !recordName || !PROXYABLE_TYPES.has(type)) {
      return NextResponse.json({ error: 'zone, recordName and a proxyable type are required' }, { status: 400 });
    }
    authorizeZone(request, zone, 'write-zone');

    const conn = getConnectionFromRequest(request);
    const found = findZoneLink(conn.url, zone);
    if (!found) return NextResponse.json({ error: 'Zone is not replicated to Cloudflare' }, { status: 404 });
    const creds = getIntegrationCredentials(found.integration.id);
    if (!creds) return NextResponse.json({ error: 'Stored credentials are unreadable' }, { status: 500 });

    const records = await listDnsRecords(creds, found.link.remoteZoneId!);
    const matching = records.filter(
      (r) => r.type === type && r.name.toLowerCase() === recordName
    );
    if (matching.length === 0) {
      return NextResponse.json(
        { error: 'Record not found at Cloudflare yet — wait for the AXFR to propagate it' },
        { status: 404 }
      );
    }
    for (const record of matching) {
      await setRecordProxied(creds, found.link.remoteZoneId!, record.id, proxied);
    }
    logActivity({
      ...actorFromHeaders(request),
      action: 'update', resourceType: 'integration',
      resourceId: found.integration.id, resourceName: found.integration.name,
      details: `CF proxy ${proxied ? 'on' : 'off'}: ${recordName} ${type} in ${zone} (${matching.length} record(s))`,
    });
    return NextResponse.json({ ok: true, updated: matching.length, proxied });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
