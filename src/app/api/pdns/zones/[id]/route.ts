import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import {
  getAuthContextFromHeaders, requireAuth, requireZoneAccess, requireRole,
  isZoneLevelPatch, canSeeAllZones, AuthzError, authzErrorResponse,
} from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer, setZoneAccountInCache } from '@/lib/cache/zones';

type RouteContext = { params: Promise<{ id: string }> };

// SECURITY: resolve the zone account against the SAME PowerDNS server that
// the proxy operation targets. conn.url is resolved server-side from the
// stored connection (x-pdns-connection-id → DB, else default/env), so the
// caller can no longer point the authz lookup at a different server's cache
// than the one the write lands on.
function zoneAccountFor(request: NextRequest, zoneId: string): string | null {
  const conn = getConnectionFromRequest(request);
  return getZoneAccountByIdAndServer(conn.url, zoneId);
}

// GET /api/pdns/zones/[id] - Get zone details with records
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const { id } = await params;
    const account = zoneAccountFor(request, id);
    if (account === null && !canSeeAllZones(ctx.role)) {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');

    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}?rrsets=true`);
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/pdns/zones/[id] - Update zone records (RRsets)
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();

    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = zoneAccountFor(request, id);
    if (account === null && !canSeeAllZones(ctx.role)) {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-records');
    if (ctx.role === 'Customer' && Array.isArray(body.rrsets) && isZoneLevelPatch(body.rrsets, id)) {
      throw new AuthzError(403, 'Customers cannot modify zone-level records (SOA / apex NS / DNSSEC)');
    }

    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/pdns/zones/[id] - Update zone properties
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();

    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = zoneAccountFor(request, id);
    if (account === null && !canSeeAllZones(ctx.role)) {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-zone');
    if (
      !canSeeAllZones(ctx.role) &&
      body.account !== undefined &&
      String(body.account) !== (account ?? '')
    ) {
      if (!body.account || !ctx.groupSlugs.includes(String(body.account))) {
        throw new AuthzError(403, 'Cannot reassign the zone to a group outside your access');
      }
    }

    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (response.ok && body.account !== undefined && String(body.account) !== (account ?? '')) {
      setZoneAccountInCache(conn.url, id, String(body.account));
    }
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/pdns/zones/[id] - Delete zone
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    requireRole(getAuthContextFromHeaders(request), 'Administrator');

    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}`, {
      method: 'DELETE',
    });
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
