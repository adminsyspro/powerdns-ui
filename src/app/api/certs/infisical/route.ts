import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getInfisicalConfig, saveInfisicalConfig } from '@/lib/certs/infisical-config';

export async function GET(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const config = getInfisicalConfig();
    return NextResponse.json(config ?? {
      enabled: false, siteUrl: '', clientId: '', hasClientSecret: false,
      projectId: '', environment: 'production', secretBasePath: '/ssl',
    });
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const body = await request.json();
    const config = saveInfisicalConfig({
      enabled: !!body.enabled,
      siteUrl: String(body.site_url || body.siteUrl || '').replace(/\/+$/, ''),
      clientId: String(body.client_id || body.clientId || ''),
      clientSecret: body.client_secret || body.clientSecret || undefined,
      projectId: String(body.project_id || body.projectId || ''),
      environment: String(body.environment || 'production'),
      secretBasePath: String(body.secret_base_path || body.secretBasePath || '/ssl'),
    });
    return NextResponse.json(config);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
