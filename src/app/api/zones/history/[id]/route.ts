import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
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
    const conn = getConnectionFromRequest(_request);
    const ctx = requireAuth(getAuthContextFromHeaders(_request));
    const account = getZoneAccountByIdAndServer(conn.url, entry.zoneId ?? '');
    requireZoneAccess(ctx, { account: account ?? '' }, 'read');
    return NextResponse.json(entry);
  } catch (error) {
    return authzErrorResponse(error);
  }
}
