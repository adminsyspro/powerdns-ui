import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCertificate } from '@/lib/certs/cert-store';
import { reconcileCertificate } from '@/lib/certs/distribution/reconcile';
import { distributionErrorResponse } from '@/lib/certs/distribution/route-util';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

/** Publish this certificate to all of its destinations now (forced, even if up to date). */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!cert.hasCert) return NextResponse.json({ error: 'certificate not issued yet' }, { status: 400 });
    const summary = await reconcileCertificate(id, { force: true });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'sync', resourceType: 'certificate',
      resourceId: id, resourceName: cert.name,
      details: `published=${summary.published}, failed=${summary.failed}, skipped=${summary.skipped}`,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
