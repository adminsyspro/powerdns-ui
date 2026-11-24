import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getDistributionRow } from '@/lib/certs/distribution/distribution-store';
import { reconcileDistribution } from '@/lib/certs/distribution/reconcile';
import { distributionErrorResponse } from '@/lib/certs/distribution/route-util';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string; distId: string }> };

/** Publish this destination now, even if it looks up to date. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id, distId } = await params;
    const row = getDistributionRow(distId);
    if (row?.certificate_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const outcome = await reconcileDistribution(distId, { force: true });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'sync', resourceType: 'certificate_distribution',
      resourceId: distId, resourceName: row.cert_name,
      details: outcome.error ? `${row.conn_name}: ${outcome.action} (${outcome.error})` : `${row.conn_name}: ${outcome.action}`,
    });
    return NextResponse.json(outcome);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
