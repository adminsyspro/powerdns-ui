import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { saveChangeset, getHistory } from '@/lib/cache/history';
import { getAuthContextFromHeaders, requireAuth, requireZoneAccess, canSeeAllZones, AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

const PDNS_SERVER_URL = process.env.PDNS_API_URL || 'http://localhost:8081';

// POST /api/zones/history - Save a changeset to history
export async function POST(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const body = await request.json();
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = getZoneAccountByIdAndServer(PDNS_SERVER_URL, String(body.zoneId ?? ''));
    if (account === null && ctx.role !== 'Administrator') {
      throw new AuthzError(403, 'Zone not found in cache; cannot record history');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-records');
    saveChangeset(conn.url, {
      ...body,
      user: request.headers.get('x-user-name') || body.user || 'unknown',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthzError) return authzErrorResponse(error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/zones/history?zoneId=&page=&pageSize=
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const allowed = canSeeAllZones(ctx.role) ? undefined : ctx.groupSlugs;
    const { searchParams } = new URL(request.url);
    const result = getHistory(conn.url, {
      zoneId: searchParams.get('zoneId') || undefined,
      page: Number.parseInt(searchParams.get('page') || '1'),
      pageSize: Number.parseInt(searchParams.get('pageSize') || '20'),
    }, allowed);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthzError) return authzErrorResponse(error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
