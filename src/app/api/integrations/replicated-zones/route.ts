import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { normalizeUrl, getZoneAccountByIdAndServer } from '@/lib/cache/zones';
import {
  getAuthContextFromHeaders, requireAuth, canSeeAllZones, canAccessZone,
  AuthzError, authzErrorResponse,
} from '@/lib/auth/authz';
import { listReplicatedZoneNames } from '@/lib/integrations/sync';

// GET /api/integrations/replicated-zones — canonical names of the zones
// replicated to a provider (Cloudflare secondary) on the current connection.
// Powers the orange-cloud marker in the zones list and zone switcher. Scoped
// users only see names they can read; admins/operators see all.
export async function GET(request: NextRequest) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const conn = getConnectionFromRequest(request);
    const serverUrl = normalizeUrl(conn.url);

    let zones = listReplicatedZoneNames(serverUrl);
    if (!canSeeAllZones(ctx.role)) {
      zones = zones.filter((zoneName) => {
        const account = getZoneAccountByIdAndServer(conn.url, zoneName);
        return account !== null && canAccessZone(ctx, account, 'read');
      });
    }

    return NextResponse.json({ zones });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
