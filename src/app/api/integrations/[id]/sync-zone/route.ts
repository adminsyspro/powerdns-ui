import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getConnectionById } from '@/lib/integrations/connections';
import { getIntegration } from '@/lib/integrations/store';
import { provisionOneZone } from '@/lib/integrations/sync';
import { logActivity, clientIp } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/sync-zone  body: { zoneName: string }
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = requireAdmin(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const zoneName = typeof body.zoneName === 'string' ? body.zoneName.trim() : '';
    if (!zoneName) return NextResponse.json({ error: 'zoneName is required' }, { status: 400 });

    const integration = getIntegration(id);
    if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const conn = integration.connectionId ? getConnectionById(integration.connectionId) : undefined;
    if (!conn) return NextResponse.json({ error: 'No PowerDNS connection bound' }, { status: 409 });

    const result = await provisionOneZone(id, conn.url, zoneName);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'integration',
      resourceId: id, resourceName: integration.name,
      details: `zone synced: ${result.row.zoneName} (${result.row.status})`,
    });
    return NextResponse.json({ row: result.row });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
