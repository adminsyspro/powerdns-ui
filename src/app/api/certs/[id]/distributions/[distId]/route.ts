import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getDistributionRow } from '@/lib/certs/distribution/distribution-store';
import { removeDistribution } from '@/lib/certs/distribution/reconcile';
import { distributionErrorResponse } from '@/lib/certs/distribution/route-util';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string; distId: string }> };

/** Remove a manual destination: deletes what was published there, then the destination itself. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id, distId } = await params;
    const row = getDistributionRow(distId);
    if (!row || row.certificate_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await removeDistribution(distId);
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'delete', resourceType: 'certificate_distribution',
      resourceId: distId, resourceName: row.cert_name, details: row.conn_name,
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
