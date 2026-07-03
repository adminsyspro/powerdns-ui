import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration } from '@/lib/integrations/store';
import { getConnectionById } from '@/lib/integrations/connections';
import { forceZoneAxfr } from '@/lib/integrations/sync';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/force-axfr — re-trigger the transfer of one zone
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = requireAdmin(request);
    const { id } = await params;
    const integration = getIntegration(id);
    if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const conn = integration.connectionId ? getConnectionById(integration.connectionId) : undefined;
    if (!conn) {
      return NextResponse.json(
        { error: 'Integration is not bound to an existing PowerDNS connection' },
        { status: 409 }
      );
    }
    const body = await request.json();
    const zoneName = typeof body.zoneName === 'string' ? body.zoneName : '';
    if (!zoneName) return NextResponse.json({ error: 'zoneName is required' }, { status: 400 });
    const result = await forceZoneAxfr(id, conn.url, zoneName);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'integration',
      resourceId: id, resourceName: integration.name,
      details: `force AXFR: ${zoneName}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
