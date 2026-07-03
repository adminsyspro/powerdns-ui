import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { getOidcConfig, saveOidcConfig, getPublicBaseUrl } from '@/lib/auth/oidc';
import { logActivity, clientIp } from '@/lib/activity/log';

// GET /api/settings/oidc — current config (client secret never returned).
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const c = getOidcConfig();
    const { clientSecret, ...rest } = c;
    // Effective redirect URI the server would actually use right now (given the
    // configured override, env, or request host) — shown read-only in the UI so
    // the admin knows exactly what to register in the IdP.
    const callbackUrl = new URL('/api/auth/oidc/callback', getPublicBaseUrl(request.url)).toString();
    return NextResponse.json({ ...rest, hasClientSecret: clientSecret.length > 0, callbackUrl });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/settings/oidc — save config.
export async function PUT(request: NextRequest) {
  try {
    const ctx = requireAdmin(request);
    const body = await request.json();
    if (body.enabled) {
      const issuer = String(body.issuerUrl ?? '').trim();
      const clientId = String(body.clientId ?? '').trim();
      if (!issuer || !clientId) {
        return NextResponse.json(
          { error: 'issuerUrl and clientId are required when OIDC is enabled' },
          { status: 400 }
        );
      }
    }
    const appBaseUrl = String(body.appBaseUrl ?? '').trim();
    if (appBaseUrl) {
      let ok = false;
      try {
        const u = new URL(appBaseUrl);
        ok = u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) {
        return NextResponse.json(
          { error: 'Application URL must be a valid http(s) URL (e.g. https://dns.example.com)' },
          { status: 400 }
        );
      }
    }
    saveOidcConfig(body);

    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'setting',
      resourceId: 'oidc', resourceName: 'oidc',
      details: `enabled=${!!body.enabled}`,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
