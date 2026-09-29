import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse, AuthzError } from '@/lib/auth/authz';
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
    if (e instanceof AuthzError) return authzErrorResponse(e);
    // Always answer JSON: an unhandled throw becomes an HTML 500 the client can't parse.
    console.error('[integrations] preview failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Preview failed' }, { status: 500 });
  }
}
