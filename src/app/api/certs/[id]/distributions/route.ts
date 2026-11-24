import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCertificate } from '@/lib/certs/cert-store';
import {
  ensureAutoDistributions, listDistributionsForCertificate, addManualDistribution,
} from '@/lib/certs/distribution/distribution-store';
import { reconcileDistribution } from '@/lib/certs/distribution/reconcile';
import { distributionErrorResponse, readJson } from '@/lib/certs/distribution/route-util';
import { asString } from '@/lib/certs/distribution/text';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    if (!getCertificate(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    ensureAutoDistributions();
    return NextResponse.json(listDistributionsForCertificate(id));
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

/** Add a destination `{ connectionId, target }`; publishes right away when the certificate is issued. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await readJson(request);
    const dist = addManualDistribution({ certificateId: id, connectionId: asString(body.connectionId), target: body.target });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'create', resourceType: 'certificate_distribution',
      resourceId: dist.id, resourceName: cert.name,
      details: `${dist.connectionName}: ${JSON.stringify(dist.resolvedTarget)}`,
    });
    const outcome = cert.hasCert ? await reconcileDistribution(dist.id) : null;
    const fresh = listDistributionsForCertificate(id).find((d) => d.id === dist.id) ?? dist;
    return NextResponse.json({ distribution: fresh, outcome }, { status: 201 });
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
