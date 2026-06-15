import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration } from '@/lib/integrations/store';
import { getConnectionById } from '@/lib/integrations/connections';
import { purgeOrphanZone } from '@/lib/integrations/sync';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/purge-orphan — delete one orphaned remote zone now
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const zoneName = typeof body.zoneName === 'string' ? body.zoneName.trim() : '';
    if (!zoneName) return NextResponse.json({ error: 'zoneName is required' }, { status: 400 });

    const integration = getIntegration(id);
    if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const conn = integration.connectionId ? getConnectionById(integration.connectionId) : undefined;
    if (!conn) return NextResponse.json({ error: 'Integration is not bound to an existing PowerDNS connection' }, { status: 409 });

    // Canonicalize to the trailing-dot form used in integration_zones.
    const canonical = zoneName.endsWith('.') ? zoneName.toLowerCase() : `${zoneName.toLowerCase()}.`;
    const result = await purgeOrphanZone(id, conn.url, canonical);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
