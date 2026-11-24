import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getConnection, providerContext } from '@/lib/certs/distribution/connection-store';
import { getProvider } from '@/lib/certs/distribution/registry';
import { distributionErrorResponse } from '@/lib/certs/distribution/route-util';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Read-only check of a connection. Optional JSON body `{ target }` (a target
 * spec, placeholders resolved with a sample certificate) also checks that
 * destination; without it only authentication / reachability is tested.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const conn = getConnection(id);
    if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const provider = getProvider(conn.type);
    let body: Record<string, unknown> = {};
    try { body = (await request.json()) ?? {}; } catch { /* no body */ }
    const target = body.target !== undefined
      ? provider.resolveTarget(provider.normalizeTarget(body.target), { name: 'sample-cert', category: null }, conn.config)
      : undefined;
    const result = await provider.test(providerContext(conn), target);
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'test', resourceType: 'distribution_connection',
      resourceId: id, resourceName: conn.name,
      details: result.error ? `ok=${result.ok}, error=${result.error}` : `ok=${result.ok}`,
    });
    return NextResponse.json(result);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
