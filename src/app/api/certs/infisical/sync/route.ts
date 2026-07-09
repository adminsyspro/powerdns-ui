import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { syncAllCertsToInfisical } from '@/lib/certs/infisical-sync';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const summary = await syncAllCertsToInfisical();
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'sync', resourceType: 'certificate',
      resourceName: 'all',
      details: `synced=${summary.synced}, failed=${summary.failed}`,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
