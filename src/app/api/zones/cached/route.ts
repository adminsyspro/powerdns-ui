import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { getCachedZones } from '@/lib/cache/zones';

// GET /api/zones/cached?page=1&pageSize=25&search=&kind=&dnssec=&sortBy=name&sortOrder=asc
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const { searchParams } = new URL(request.url);

    const result = getCachedZones(conn.url, {
      page: parseInt(searchParams.get('page') || '1'),
      pageSize: parseInt(searchParams.get('pageSize') || '25'),
      search: searchParams.get('search') || undefined,
      kind: searchParams.get('kind') || undefined,
      dnssec: (searchParams.get('dnssec') as 'enabled' | 'disabled') || undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
