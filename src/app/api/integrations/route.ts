import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { createIntegration, listIntegrations, sanitizeConfig } from '@/lib/integrations/store';
import { connectionExists } from '@/lib/integrations/connections';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

// GET /api/integrations — list instances (credentials never leave the server)
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    return NextResponse.json(listIntegrations());
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// POST /api/integrations — create an instance
export async function POST(request: NextRequest) {
  try {
    const ctx = requireAdmin(request);
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    const apiToken = String(body.apiToken ?? '').trim();
    const config = sanitizeConfig(body.config);
    if (body.provider !== 'cloudflare') {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }
    if (!name || !apiToken || !config.accountId) {
      return NextResponse.json({ error: 'name, apiToken and config.accountId are required' }, { status: 400 });
    }
    if (config.mode === 'push') {
      return NextResponse.json({ error: 'push mode is not implemented yet — use axfr (requires Cloudflare secondary DNS)' }, { status: 400 });
    }
    if (!config.primaryIp) {
      return NextResponse.json({ error: 'config.primaryIp (public IP of the PowerDNS primary) is required for axfr mode' }, { status: 400 });
    }
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId : '';
    if (!connectionId || !connectionExists(connectionId)) {
      return NextResponse.json({ error: 'connectionId (an existing PowerDNS connection) is required' }, { status: 400 });
    }
    const integration = createIntegration({
      provider: 'cloudflare',
      name,
      connectionId,
      config,
      credentials: {
        apiToken,
        tsigSecret: body.tsigSecret ? String(body.tsigSecret) : undefined,
      },
    });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'create', resourceType: 'integration',
      resourceId: integration.id, resourceName: integration.name,
      details: `${body.provider ?? 'cloudflare'} acct ${config.accountId ?? ''}, mode ${config.mode ?? ''}`,
    });
    return NextResponse.json(integration, { status: 201 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
