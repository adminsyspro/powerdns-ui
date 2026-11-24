import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { listConnections, createConnection } from '@/lib/certs/distribution/connection-store';
import { listProviders } from '@/lib/certs/distribution/registry';
import { distributionErrorResponse, readJson } from '@/lib/certs/distribution/route-util';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

export async function GET(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    return NextResponse.json({
      connections: listConnections(),
      providers: listProviders().map((p) => ({ type: p.type, label: p.label, needsSecret: p.needsSecret })),
    });
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const body = await readJson(request);
    const conn = createConnection({
      name: String(body.name ?? ''),
      type: String(body.type ?? ''),
      enabled: body.enabled !== false,
      config: body.config,
      secret: typeof body.secret === 'string' && body.secret ? body.secret : undefined,
      autoAttach: !!body.autoAttach,
      defaultTarget: body.defaultTarget,
    });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'create', resourceType: 'distribution_connection',
      resourceId: conn.id, resourceName: conn.name,
      details: `type=${conn.type}, autoAttach=${conn.autoAttach}`,
    });
    return NextResponse.json(conn, { status: 201 });
  } catch (e) {
    return distributionErrorResponse(e);
  }
}
