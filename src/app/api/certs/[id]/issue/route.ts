import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled, certSecretsMisconfigured } from '@/lib/certs/config';
import { getCertificate } from '@/lib/certs/cert-store';
import { enqueueJob } from '@/lib/certs/job-store';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (certSecretsMisconfigured()) {
      return NextResponse.json({ error: 'Certificate operations are disabled: set APP_SECRET (or AUTH_SECRET) so secrets are not stored under the public default key.' }, { status: 503 });
    }
    const ctx = requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = enqueueJob(id, 'issue');
    if ('alreadyActive' in result) {
      return NextResponse.json({ error: 'an issuance/renewal job is already active' }, { status: 409 });
    }
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'certificate',
      resourceId: id, resourceName: cert?.name ?? id,
      details: `issuance queued (job ${result.id})`,
    });
    return NextResponse.json({ jobId: result.id }, { status: 202 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
