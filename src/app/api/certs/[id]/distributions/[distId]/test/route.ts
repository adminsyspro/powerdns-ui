import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getDistributionRow, resolveRowTarget } from '@/lib/certs/distribution/distribution-store';
import { getConnection, providerContext } from '@/lib/certs/distribution/connection-store';
import { getProvider } from '@/lib/certs/distribution/registry';
import { distributionErrorResponse } from '@/lib/certs/distribution/route-util';

type RouteContext = { params: Promise<{ id: string; distId: string }> };

/** Read-only check of this destination (authentication + access to the resolved target). */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id, distId } = await params;
    const row = getDistributionRow(distId);
    if (!row || row.certificate_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const conn = getConnection(row.connection_id);
    if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = await getProvider(conn.type).test(providerContext(conn), resolveRowTarget(row));
    return NextResponse.json(result);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
