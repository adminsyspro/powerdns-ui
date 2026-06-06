import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { getOidcConfig, saveOidcConfig } from '@/lib/auth/oidc';

// GET /api/settings/oidc — current config (client secret never returned).
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const c = getOidcConfig();
    const { clientSecret, ...rest } = c;
    return NextResponse.json({ ...rest, hasClientSecret: clientSecret.length > 0 });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/settings/oidc — save config.
export async function PUT(request: NextRequest) {
  try {
    requireAdmin(request);
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
    saveOidcConfig(body);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
