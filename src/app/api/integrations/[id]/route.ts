import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { normalizeUrl } from '@/lib/cache/zones';
import {
  deleteIntegration,
  getIntegration,
  getIntegrationCredentials,
  listIntegrationZones,
  markZonesForReprovision,
  sanitizeConfig,
  updateIntegration,
} from '@/lib/integrations/store';
import { getSyncState } from '@/lib/integrations/sync';
import type { IntegrationConfig } from '@/lib/integrations/types';

// Provider-side peer/TSIG objects only stay valid while the settings they
// were created from are unchanged.
function peerSettingsChanged(a: IntegrationConfig, b: IntegrationConfig): boolean {
  return (
    a.accountId !== b.accountId ||
    a.primaryIp !== b.primaryIp ||
    a.primaryPort !== b.primaryPort ||
    (a.tsigName ?? '') !== (b.tsigName ?? '') ||
    (a.tsigAlgo ?? '') !== (b.tsigAlgo ?? '')
  );
}

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/integrations/[id] — instance + per-zone state + sync progress
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const integration = getIntegration(id);
    if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const conn = getConnectionFromRequest(request);
    return NextResponse.json({
      integration,
      zones: listIntegrationZones(id, normalizeUrl(conn.url)),
      sync: getSyncState(id, conn.url),
    });
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// PUT /api/integrations/[id] — update settings (token only when provided)
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const existing = getIntegration(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const config = body.config !== undefined ? sanitizeConfig(body.config) : { ...existing.config };
    const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
    const tsigSecret = typeof body.tsigSecret === 'string' ? body.tsigSecret : '';

    // Provider-managed ids survive config edits ONLY while the settings they
    // were created from are unchanged. Otherwise (including a TSIG secret
    // rotation) they are dropped and every healthy link is flagged stale so
    // the next sync recreates the peer/TSIG and relinks the zones.
    if (peerSettingsChanged(existing.config, config) || tsigSecret) {
      config.peerId = undefined;
      config.tsigId = undefined;
      markZonesForReprovision(id);
    } else {
      config.peerId = existing.config.peerId;
      config.tsigId = existing.config.tsigId;
    }

    // Merge secrets so the token and the TSIG secret rotate independently.
    let credentials;
    if (apiToken || tsigSecret) {
      const current = getIntegrationCredentials(id);
      credentials = {
        apiToken: apiToken || current?.apiToken || '',
        tsigSecret: tsigSecret || current?.tsigSecret,
      };
      if (!credentials.apiToken) {
        return NextResponse.json(
          { error: 'Stored API token is unreadable — provide apiToken with this update' },
          { status: 400 }
        );
      }
    }

    const updated = updateIntegration(id, {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
      config,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      ...(credentials ? { credentials } : {}),
    });
    return NextResponse.json(updated);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// DELETE /api/integrations/[id] — remove the instance (remote zones untouched)
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    deleteIntegration(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
