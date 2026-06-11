import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getCachedZones } from '@/lib/cache/zones';
import { getAuthContextFromHeaders, requireAuth, canSeeAllZones, authzErrorResponse } from '@/lib/auth/authz';

// GET /api/zones/cached?page=1&pageSize=25&search=&kind=&dnssec=&sortBy=name&sortOrder=asc
export async function GET(request: NextRequest) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const allowed = canSeeAllZones(ctx.role) ? undefined : ctx.groupSlugs;

    const conn = getConnectionFromRequest(request);
    const { searchParams } = new URL(request.url);

    const scopeParam = searchParams.get('scope');
    const result = getCachedZones(conn.url, {
      page: Number.parseInt(searchParams.get('page') || '1'),
      pageSize: Number.parseInt(searchParams.get('pageSize') || '25'),
      search: searchParams.get('search') || undefined,
      kind: searchParams.get('kind') || undefined,
      dnssec: (searchParams.get('dnssec') as 'enabled' | 'disabled') || undefined,
      scope: scopeParam === 'forward' || scopeParam === 'reverse' ? scopeParam : undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || undefined,
    }, allowed);

    return NextResponse.json(result);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
