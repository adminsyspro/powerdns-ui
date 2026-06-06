import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getLastChangeForRRSet } from '@/lib/cache/history';
import { getAuthContextFromHeaders, requireAuth, requireZoneAccess, authzErrorResponse } from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

const PDNS_SERVER_URL = process.env.PDNS_API_URL ?? '';

// GET /api/zones/history/rrset?zoneId=example.com.&rrsetKey=www.example.com.::A
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
    const account = getZoneAccountByIdAndServer(PDNS_SERVER_URL, zoneId);
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');

    const result = getLastChangeForRRSet(conn.url, zoneId, rrsetKey);
    if (!result) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({ found: true, ...result });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
