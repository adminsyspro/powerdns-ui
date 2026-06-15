import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest, fetchZonesFromPdns } from '@/lib/pdns-proxy';
import { syncZonesToCache, getSyncMeta } from '@/lib/cache/zones';
import { getAuthContextFromHeaders, requireRole, authzErrorResponse, AuthzError } from '@/lib/auth/authz';

// POST /api/zones/sync - Trigger a full sync from PowerDNS to cache
export async function POST(request: NextRequest) {
  try {
    requireRole(getAuthContextFromHeaders(request), 'Administrator', 'Operator');

    const conn = getConnectionFromRequest(request);
    let zones: unknown[];
    try {
      zones = await fetchZonesFromPdns(conn.url, conn.apiKey, conn.serverId);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'PowerDNS fetch failed' }, { status: 502 });
    }
    const result = syncZonesToCache(conn.url, zones as Parameters<typeof syncZonesToCache>[1]);

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/zones/sync - Get sync status
export async function GET(request: NextRequest) {
  try {
    requireRole(getAuthContextFromHeaders(request), 'Administrator', 'Operator');

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
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
