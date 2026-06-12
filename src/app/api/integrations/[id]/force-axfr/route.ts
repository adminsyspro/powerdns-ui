import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { forceZoneAxfr } from '@/lib/integrations/sync';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/force-axfr — re-trigger the transfer of one zone
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const zoneName = typeof body.zoneName === 'string' ? body.zoneName : '';
    if (!zoneName) return NextResponse.json({ error: 'zoneName is required' }, { status: 400 });
    const conn = getConnectionFromRequest(request);
    const result = await forceZoneAxfr(id, conn.url, zoneName);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
