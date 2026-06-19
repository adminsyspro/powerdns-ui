import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getChangeCountsForZone } from '@/lib/cache/history';
import { getAuthContextFromHeaders, requireAuth, requireZoneAccess, authzErrorResponse } from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

// GET /api/zones/history/counts?zoneId=example.com.
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const zoneId = new URL(request.url).searchParams.get('zoneId');
    if (!zoneId) {
      return NextResponse.json({ error: 'zoneId is required' }, { status: 400 });
    }
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = getZoneAccountByIdAndServer(conn.url, zoneId);
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');

    const counts = getChangeCountsForZone(conn.url, zoneId);
    return NextResponse.json({ counts });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
