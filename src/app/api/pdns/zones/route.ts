import { NextRequest, NextResponse } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getAuthContextFromHeaders, requireAuth, requireCreateInGroup, canSeeAllZones, AuthzError, authzErrorResponse } from '@/lib/auth/authz';

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
    requireCreateInGroup(ctx, account);
    body.account = account; // forward exactly the authorized account (prevents type-confusion)

    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return forwardPdnsResponse(response);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
