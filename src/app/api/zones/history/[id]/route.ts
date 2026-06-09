import { NextRequest, NextResponse } from 'next/server';
import { getHistoryEntry } from '@/lib/cache/history';
import { getAuthContextFromHeaders, requireAuth, requireZoneAccess, authzErrorResponse } from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

// GET /api/zones/history/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entry = getHistoryEntry(id);
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const ctx = requireAuth(getAuthContextFromHeaders(_request));
    // Authorize against the entry's ORIGINATING server (stored on the row), NOT the
    // request's active connection: otherwise a caller could authorize a foreign-server
    // entry against a same-zone-id zone on a server where they happen to have access (IDOR).
    const account = getZoneAccountByIdAndServer(entry.serverUrl, entry.zoneId ?? '');
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');
    return NextResponse.json(entry);
  } catch (error) {
    return authzErrorResponse(error);
  }
}
