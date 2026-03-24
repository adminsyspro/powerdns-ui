import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getCachedZoneStats, getSyncMeta } from '@/lib/cache/zones';

// GET /api/zones/cached/stats - Get aggregate zone stats from cache
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const stats = getCachedZoneStats(conn.url);
    const syncMeta = getSyncMeta(conn.url);

    return NextResponse.json({
      ...stats,
      lastSyncAt: syncMeta?.lastSyncAt || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
