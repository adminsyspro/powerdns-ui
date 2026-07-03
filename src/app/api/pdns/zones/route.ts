import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getAuthContextFromHeaders, requireAuth, requireCreateInGroup, canSeeAllZones, AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { autoProvisionZone } from '@/lib/integrations/sync';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

// GET /api/pdns/zones - List all zones
export async function GET(request: NextRequest) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));

    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`);

    if (!response.ok) {
      return forwardPdnsResponse(response);
    }

    const data = await response.json() as Array<{ account?: string }>;

    const visible = canSeeAllZones(ctx.role)
      ? data
      : data.filter((z) => z.account && ctx.groupSlugs.includes(z.account));

    return NextResponse.json(visible);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/pdns/zones - Create a new zone
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const ctx = getAuthContextFromHeaders(request);
    const account = typeof body.account === 'string' ? body.account.trim() : '';
    const authed = requireCreateInGroup(ctx, account);
    body.account = account; // forward exactly the authorized account (prevents type-confusion)

    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (response.ok && typeof body.name === 'string') {
      // Best-effort: replicate the new zone to active integrations in scope.
      const zoneName = body.name.endsWith('.') ? body.name : `${body.name}.`;
      try {
        autoProvisionZone(conn.url, zoneName, String(body.kind ?? ''), account);
      } catch { /* never block zone creation on integration errors */ }
      logActivity({
        ...actorFromRequest(request, authed),
        action: 'create', resourceType: 'zone',
        resourceId: zoneName, resourceName: zoneName,
        details: `kind=${body.kind}`,
      });
    }
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
