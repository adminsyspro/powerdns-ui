import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getInfisicalConfig, saveInfisicalConfig } from '@/lib/certs/infisical-config';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

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
    const ctx = requireAdmin(request);
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
    // Never log the secret value itself — only which fields changed.
    const changed = [
      body.enabled !== undefined ? 'enabled' : null,
      (body.site_url !== undefined || body.siteUrl !== undefined) ? 'siteUrl' : null,
      (body.client_id !== undefined || body.clientId !== undefined) ? 'clientId' : null,
      (body.client_secret !== undefined || body.clientSecret !== undefined) ? 'clientSecret' : null,
      (body.project_id !== undefined || body.projectId !== undefined) ? 'projectId' : null,
      body.environment !== undefined ? 'environment' : null,
      (body.secret_base_path !== undefined || body.secretBasePath !== undefined) ? 'secretBasePath' : null,
    ].filter(Boolean).join(', ') || 'config';
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'infisical_config',
      resourceName: 'infisical',
      details: changed,
    });
    return NextResponse.json(config);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
