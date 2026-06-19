import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getChangesForRRSet } from '@/lib/cache/history';
import { getAuthContextFromHeaders, requireAuth, requireZoneAccess, authzErrorResponse } from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

// GET /api/zones/history/rrset/list?zoneId=example.com.&rrsetKey=www.example.com.::A
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const { searchParams } = new URL(request.url);
    const zoneId = searchParams.get('zoneId');
    const rrsetKey = searchParams.get('rrsetKey');
    if (!zoneId || !rrsetKey) {
      return NextResponse.json({ error: 'zoneId and rrsetKey are required' }, { status: 400 });
    }
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = getZoneAccountByIdAndServer(conn.url, zoneId);
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');

    const { items, hasMore } = getChangesForRRSet(conn.url, zoneId, rrsetKey);
    return NextResponse.json({ items, hasMore });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
