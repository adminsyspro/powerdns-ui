import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration } from '@/lib/integrations/store';
import { getConnectionById } from '@/lib/integrations/connections';
import { startSync, getSyncState } from '@/lib/integrations/sync';
import { logActivity, clientIp } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/sync — reconcile scoped zones to the provider
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
    const result = startSync(id, conn.url);
    if (!result.started) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    const state = getSyncState(id, conn.url);
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'integration',
      resourceId: id, resourceName: integration.name,
      details: `sync started (${state.total} zones scoped)`,
    });
    return NextResponse.json({ sync: state }, { status: 202 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
