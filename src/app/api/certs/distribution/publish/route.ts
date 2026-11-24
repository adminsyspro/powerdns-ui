import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { listCertificates } from '@/lib/certs/cert-store';
import { reconcileCertificate, runDistributionCycle, type ReconcileSummary } from '@/lib/certs/distribution/reconcile';
import { distributionErrorResponse } from '@/lib/certs/distribution/route-util';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

/**
 * Publish every certificate now. Default: only out-of-date destinations,
 * ignoring retry backoff. `{ "force": true }`: republish everything.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    let force = false;
    try { force = !!((await request.json()) as { force?: boolean })?.force; } catch { /* no body */ }

    let summary: ReconcileSummary;
    if (force) {
      summary = { published: 0, upToDate: 0, skipped: 0, failed: 0, outcomes: [] };
      for (const c of listCertificates().filter((x) => x.hasCert)) {
        const s = await reconcileCertificate(c.id, { force: true });
        summary.published += s.published; summary.upToDate += s.upToDate;
        summary.skipped += s.skipped; summary.failed += s.failed;
        summary.outcomes.push(...s.outcomes);
      }
    } else {
      // Number.MAX_SAFE_INTEGER as "now" = ignore backoff for a manual run.
      summary = await runDistributionCycle(undefined, Number.MAX_SAFE_INTEGER);
    }
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'sync', resourceType: 'certificate', resourceName: 'all',
      details: `force=${force}, published=${summary.published}, failed=${summary.failed}`,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
