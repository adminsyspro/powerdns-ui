import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration } from '@/lib/integrations/store';
import { getConnectionById } from '@/lib/integrations/connections';
import { setZoneCustomNsSet } from '@/lib/integrations/sync';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/custom-ns-set — set the custom NS set for one
// replicated zone (nsSet: a set number) or switch it back to Cloudflare-default
// nameservers (nsSet: null). Applied directly to Cloudflare.
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
    if (body.nsSet !== null && typeof body.nsSet !== 'number') {
      return NextResponse.json({ error: 'nsSet must be a number or null' }, { status: 400 });
    }
    const nsSet: number | null = body.nsSet;
    const result = await setZoneCustomNsSet(id, conn.url, zoneName, nsSet);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'custom_ns_set',
      resourceId: id, resourceName: zoneName,
      details: nsSet === null ? `${zoneName}: reset to Cloudflare-default NS` : `${zoneName}: NS set ${nsSet}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
