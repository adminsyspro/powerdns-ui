import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { buildZonePreview } from '@/lib/integrations/preview';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/integrations/[id]/preview?refresh=1
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const preview = await buildZonePreview(id, { refresh });
    if (!preview) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(preview);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
