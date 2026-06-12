import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { startSync, getSyncState } from '@/lib/integrations/sync';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/sync — reconcile scoped zones to the provider
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const result = startSync(id, conn.url);
    if (!result.started) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ sync: getSyncState(id) }, { status: 202 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
