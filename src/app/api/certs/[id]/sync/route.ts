import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { syncCertToInfisical } from '@/lib/certs/infisical-sync';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    await syncCertToInfisical(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes('not found')) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    return authzErrorResponse(e);
  }
}
