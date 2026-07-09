import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { syncCertToInfisical } from '@/lib/certs/infisical-sync';
import { isInfisicalEnabled } from '@/lib/certs/infisical-config';
import { getCertificate } from '@/lib/certs/cert-store';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    if (!isInfisicalEnabled()) {
      return NextResponse.json({ ok: false, error: 'Infisical is not enabled' }, { status: 400 });
    }
    const { id } = await params;
    await syncCertToInfisical(id);
    const cert = getCertificate(id);
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'sync', resourceType: 'certificate',
      resourceId: id, resourceName: cert?.name ?? id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes('not found')) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof Error) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
    }
    return authzErrorResponse(e);
  }
}
