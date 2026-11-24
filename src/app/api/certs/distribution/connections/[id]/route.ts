import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getConnection, updateConnection, countDistributionsForConnection } from '@/lib/certs/distribution/connection-store';
import { clearInfisicalTokenCache } from '@/lib/certs/distribution/providers/infisical-secrets';
import { removeConnection } from '@/lib/certs/distribution/reconcile';
import { distributionErrorResponse, readJson } from '@/lib/certs/distribution/route-util';
import { asString } from '@/lib/certs/distribution/text';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    const conn = getConnection(id);
    if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ...conn, distributionCount: countDistributionsForConnection(id) });
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const body = await readJson(request);
    const conn = updateConnection(id, {
      name: body.name === undefined ? undefined : asString(body.name),
      enabled: body.enabled !== undefined ? !!body.enabled : undefined,
      config: body.config,
      secret: typeof body.secret === 'string' && body.secret ? body.secret : undefined,
      autoAttach: body.autoAttach !== undefined ? !!body.autoAttach : undefined,
      defaultTarget: body.defaultTarget,
    });
    clearInfisicalTokenCache(id);
    // Never log secret values — only which fields changed.
    const changed = ['name', 'enabled', 'config', 'secret', 'autoAttach', 'defaultTarget']
      .filter((k) => body[k] !== undefined && !(k === 'secret' && !body.secret)).join(', ') || 'settings';
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'distribution_connection',
      resourceId: conn.id, resourceName: conn.name, details: changed,
    });
    return NextResponse.json(conn);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

/** Deleting a connection unpublishes everything it distributed first (stops at the first failure). */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const conn = getConnection(id);
    if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await removeConnection(id);
    clearInfisicalTokenCache(id);
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'delete', resourceType: 'distribution_connection',
      resourceId: id, resourceName: conn.name, details: `type=${conn.type}`,
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
