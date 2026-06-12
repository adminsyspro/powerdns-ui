import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getAuthContextFromHeaders, requireRole, authzErrorResponse } from '@/lib/auth/authz';
import { startScan, getScanState } from '@/lib/ns-audit';

// POST /api/zones/ns-audit/scan - Launch a delegation scan of all forward zones.
export async function POST(request: NextRequest) {
  try {
    requireRole(getAuthContextFromHeaders(request), 'Administrator', 'Operator');
    const conn = getConnectionFromRequest(request);
    const result = startScan(conn.url);
    if (!result.started) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ scan: getScanState(conn.url) }, { status: 202 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
