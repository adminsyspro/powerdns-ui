import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import {
  getAuthContextFromHeaders, requireAuth, requireZoneAccess, canSeeAllZones,
  AuthzError, authzErrorResponse,
} from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

type RouteContext = { params: Promise<{ id: string; keyId: string }> };

// Shared authz: key changes are zone-level operations (Admin/Operator only).
async function authorize(request: NextRequest, params: RouteContext['params']) {
  const ctx = requireAuth(getAuthContextFromHeaders(request));
  const { id, keyId } = await params;
  if (!/^\d+$/.test(keyId)) {
    throw new AuthzError(400, 'Invalid cryptokey id');
  }
  const conn = getConnectionFromRequest(request);
  const account = getZoneAccountByIdAndServer(conn.url, id);
  if (account === null && !canSeeAllZones(ctx.role)) {
    throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
  }
  requireZoneAccess(ctx, { account: account ?? '' }, 'write-zone');
  return { conn, id, keyId };
}

// PUT /api/pdns/zones/[id]/cryptokeys/[keyId] - Update a key (activate/deactivate/publish)
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { conn, id, keyId } = await authorize(request, params);
    const body = await request.json();
    const response = await pdnsProxy(
      request,
      `/servers/${conn.serverId}/zones/${id}/cryptokeys/${keyId}`,
      { method: 'PUT', body: JSON.stringify(body) }
    );
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/pdns/zones/[id]/cryptokeys/[keyId] - Delete a key
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { conn, id, keyId } = await authorize(request, params);
    const response = await pdnsProxy(
      request,
      `/servers/${conn.serverId}/zones/${id}/cryptokeys/${keyId}`,
      { method: 'DELETE' }
    );
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
