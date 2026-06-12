import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getAuthContextFromHeaders, requireRole, authzErrorResponse } from '@/lib/auth/authz';
import { getAuditResults, getScanState } from '@/lib/ns-audit';

// GET /api/zones/ns-audit - Stored audit results + current scan state.
// Admin/Operator only: the audit spans every zone on the server.
export async function GET(request: NextRequest) {
  try {
    requireRole(getAuthContextFromHeaders(request), 'Administrator', 'Operator');
    const conn = getConnectionFromRequest(request);
    return NextResponse.json({
      ...getAuditResults(conn.url),
      scan: getScanState(conn.url),
    });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
