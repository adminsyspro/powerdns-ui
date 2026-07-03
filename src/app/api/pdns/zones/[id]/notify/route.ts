import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getAuthContextFromHeaders, requireAuth, requireZoneAccess, canSeeAllZones, AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';
import { logActivity, clientIp } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/pdns/zones/[id]/notify - Send NOTIFY to slaves
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const account = getZoneAccountByIdAndServer(conn.url, id);
    if (account === null && !canSeeAllZones(ctx.role)) {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-zone');
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}/notify`, {
      method: 'PUT',
    });
    if (response.ok) {
      logActivity({
        actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
        action: 'update', resourceType: 'zone',
        resourceId: id, resourceName: id,
        details: 'NOTIFY',
      });
    }
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
