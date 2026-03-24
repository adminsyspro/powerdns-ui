import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest, pdnsProxy } from '@/lib/pdns-proxy';
import { syncZonesToCache, getSyncMeta } from '@/lib/cache/zones';

// POST /api/zones/sync - Trigger a full sync from PowerDNS to cache
export async function POST(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);

    // Fetch all zones from PowerDNS
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`);

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `PowerDNS returned ${response.status}: ${text}` },
        { status: 502 }
      );
    }

    const zones = await response.json();

    // Sync to SQLite cache
    const result = syncZonesToCache(conn.url, zones);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/zones/sync - Get sync status
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const meta = getSyncMeta(conn.url);

    if (!meta) {
      return NextResponse.json({ lastSyncAt: 0, zoneCount: 0, durationMs: 0, needsSync: true });
    }

    return NextResponse.json({
      ...meta,
      needsSync: false,
      age: Date.now() - meta.lastSyncAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
