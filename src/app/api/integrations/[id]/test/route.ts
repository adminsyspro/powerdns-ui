import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getIntegration, getIntegrationCredentials } from '@/lib/integrations/store';
import { verifyToken, listZones } from '@/lib/integrations/cloudflare';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/integrations/[id]/test — verify the stored token and account access
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const integration = getIntegration(id);
    if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const creds = getIntegrationCredentials(id);
    if (!creds) {
      return NextResponse.json({ error: 'Stored credentials are unreadable (APP_SECRET changed?)' }, { status: 500 });
    }
    try {
      await verifyToken(creds, integration.config.accountId);
      const zones = await listZones(creds, integration.config.accountId);
      return NextResponse.json({ ok: true, remoteZones: zones.length });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'verification failed' },
        { status: 502 }
      );
    }
  } catch (e) {
    return authzErrorResponse(e);
  }
}
