import { NextRequest, NextResponse } from 'next/server';
import * as client from 'openid-client';
import { getOidcConfig, getOidcConfiguration, getPublicBaseUrl } from '@/lib/auth/oidc';

const COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 300,
  secure: process.env.FORCE_HTTPS === 'true',
};

// GET /api/auth/oidc/login — start the OIDC authorization-code (PKCE) flow.
export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.url);
  try {
    const cfg = getOidcConfig();
    const config = await getOidcConfiguration(cfg);
    if (!config) {
      return NextResponse.redirect(new URL('/login?error=oidc_unavailable', base));
    }

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const redirectUri = new URL('/api/auth/oidc/callback', base).toString();

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: cfg.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const res = NextResponse.redirect(authUrl);
    res.cookies.set('pdns-oidc-verifier', codeVerifier, COOKIE_OPTS);
    res.cookies.set('pdns-oidc-state', state, COOKIE_OPTS);
    res.cookies.set('pdns-oidc-nonce', nonce, COOKIE_OPTS);
    return res;
  } catch {
    return NextResponse.redirect(new URL('/login?error=oidc_error', base));
  }
}
