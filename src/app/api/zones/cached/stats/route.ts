import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getCachedZoneStats, getSyncMeta } from '@/lib/cache/zones';
import { getAuthContextFromHeaders, requireAuth, canSeeAllZones, authzErrorResponse } from '@/lib/auth/authz';

// GET /api/zones/cached/stats - Get aggregate zone stats from cache
export async function GET(request: NextRequest) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const allowed = canSeeAllZones(ctx.role) ? undefined : ctx.groupSlugs;

    const conn = getConnectionFromRequest(request);
    const stats = getCachedZoneStats(conn.url, allowed);
    const syncMeta = getSyncMeta(conn.url);

    return NextResponse.json({
      ...stats,
      lastSyncAt: syncMeta?.lastSyncAt || 0,
    });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
