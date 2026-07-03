import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import {
  getAuthContextFromHeaders, requireAuth, requireZoneAccess, canSeeAllZones,
  AuthzError, authzErrorResponse,
} from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';
import { logActivity, clientIp } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/pdns/zones/[id]/cryptokeys - List DNSSEC keys (DS/DNSKEY are public
// data, so read access suffices). privatekey is stripped defensively: it must
// never leave the server even if PowerDNS includes it.
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const account = getZoneAccountByIdAndServer(conn.url, id);
    if (account === null && !canSeeAllZones(ctx.role)) {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');

    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}/cryptokeys`);
    if (!response.ok) return forwardPdnsResponse(response);

    const keys = (await response.json()) as Array<Record<string, unknown>>;
    return NextResponse.json(keys.map(({ privatekey: _privatekey, ...key }) => key));
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/pdns/zones/[id]/cryptokeys - Create a DNSSEC key (Admin/Operator)
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const account = getZoneAccountByIdAndServer(conn.url, id);
    if (account === null && !canSeeAllZones(ctx.role)) {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-zone');

    const body = await request.json();
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}/cryptokeys`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok || response.status === 204) return forwardPdnsResponse(response);

    const { privatekey: _privatekey, ...key } = (await response.json()) as Record<string, unknown>;
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'zone',
      resourceId: id, resourceName: id,
      details: `DNSSEC key created (${String(key.keytype ?? '')})`,
    });
    return NextResponse.json(key, { status: response.status });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
