import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import {
  deleteIntegration,
  getIntegration,
  listIntegrationZones,
  sanitizeConfig,
  updateIntegration,
} from '@/lib/integrations/store';
import { getSyncState } from '@/lib/integrations/sync';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/integrations/[id] — instance + per-zone state + sync progress
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const integration = getIntegration(id);
    if (!integration) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({
      integration,
      zones: listIntegrationZones(id),
      sync: getSyncState(id),
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
    const config = body.config !== undefined ? sanitizeConfig(body.config) : existing.config;
    // Provider-managed ids survive config edits.
    config.peerId = existing.config.peerId;
    config.tsigId = existing.config.tsigId;

    const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
    const tsigSecret = typeof body.tsigSecret === 'string' ? body.tsigSecret : '';
    const updated = updateIntegration(id, {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
      config,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      ...(apiToken
        ? { credentials: { apiToken, tsigSecret: tsigSecret || undefined } }
        : {}),
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
