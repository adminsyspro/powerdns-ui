import { NextRequest } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import {
  getAuthContextFromHeaders, requireAuth, requireZoneAccess, canSeeAllZones, AuthzError,
} from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

/** Ensure a zone name ends with a trailing dot (PowerDNS canonical form). */
export function canonZone(zone: string): string {
  return zone.endsWith('.') ? zone : `${zone}.`;
}

/**
 * Authorize the caller for a zone (group-scoped). Throws AuthzError on failure.
 * Shared by the integrations zone-proxy, zone-traffic and zone-dns-analytics routes.
 */
export function authorizeZone(request: NextRequest, zoneName: string, action: 'read' | 'write-zone') {
  const ctx = requireAuth(getAuthContextFromHeaders(request));
  const conn = getConnectionFromRequest(request);
  const account = getZoneAccountByIdAndServer(conn.url, zoneName);
  if (account === null && !canSeeAllZones(ctx.role)) {
    throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
  }
  requireZoneAccess(ctx, { account: account ?? '' }, action);
}
