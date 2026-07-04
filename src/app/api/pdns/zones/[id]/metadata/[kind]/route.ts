import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import {
  getAuthContextFromHeaders, requireAuth, requireZoneAccess, canSeeAllZones,
  AuthzError, authzErrorResponse,
} from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string; kind: string }> };

// Only transfer-related metadata is editable through the UI. Arbitrary kinds
// stay blocked: several (SOA-EDIT-API, API-RECTIFY, …) are managed via the
// zone object, and others can change server behaviour in surprising ways.
const ALLOWED_KINDS = new Set(['ALLOW-AXFR-FROM', 'ALSO-NOTIFY']);

async function authorize(
  request: NextRequest,
  params: RouteContext['params'],
  action: 'read' | 'write-zone'
) {
  const ctx = requireAuth(getAuthContextFromHeaders(request));
  const { id, kind } = await params;
  const kindUpper = decodeURIComponent(kind).toUpperCase();
  if (!ALLOWED_KINDS.has(kindUpper)) {
    throw new AuthzError(400, `Unsupported metadata kind: ${kindUpper}`);
  }
  const conn = getConnectionFromRequest(request);
  const account = getZoneAccountByIdAndServer(conn.url, id);
  if (account === null && !canSeeAllZones(ctx.role)) {
    throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
  }
  requireZoneAccess(ctx, { account: account ?? '' }, action);
  return { ctx, conn, id, kind: kindUpper };
}

// GET /api/pdns/zones/[id]/metadata/[kind] - Read one metadata kind.
// PowerDNS may answer 404 when the kind is unset; normalize to an empty list.
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { conn, id, kind } = await authorize(request, params, 'read');
    const response = await pdnsProxy(
      request,
      `/servers/${conn.serverId}/zones/${id}/metadata/${kind}`
    );
    if (response.status === 404) {
      return NextResponse.json({ kind, metadata: [] });
    }
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/pdns/zones/[id]/metadata/[kind] - Replace one metadata kind.
// An empty list removes the kind entirely (DELETE on PowerDNS).
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { ctx, conn, id, kind } = await authorize(request, params, 'write-zone');
    const body = await request.json();
    const metadata = Array.isArray(body.metadata)
      ? body.metadata.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '')
      : [];

    if (metadata.length === 0) {
      const response = await pdnsProxy(
        request,
        `/servers/${conn.serverId}/zones/${id}/metadata/${kind}`,
        { method: 'DELETE' }
      );
      // PowerDNS answers 404 when deleting a kind that was never set — for the
      // caller "no values" is already true, so treat it as success.
      if (response.status === 404 || response.ok) {
        logActivity({
          ...actorFromRequest(request, ctx),
          action: 'update', resourceType: 'zone',
          resourceId: id, resourceName: id,
          details: `metadata ${kind} cleared`,
        });
        return NextResponse.json({ kind, metadata: [] });
      }
      return forwardPdnsResponse(response);
    }

    const response = await pdnsProxy(
      request,
      `/servers/${conn.serverId}/zones/${id}/metadata/${kind}`,
      { method: 'PUT', body: JSON.stringify({ kind, metadata }) }
    );
    if (response.ok) {
      logActivity({
        ...actorFromRequest(request, ctx),
        action: 'update', resourceType: 'zone',
        resourceId: id, resourceName: id,
        details: `${kind} = ${metadata.length > 10 ? `${metadata.slice(0, 10).join(', ')}, +${metadata.length - 10} more` : metadata.join(', ')}`,
      });
    }
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
