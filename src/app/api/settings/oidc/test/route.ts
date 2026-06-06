import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import * as client from 'openid-client';
import { requireAdmin, AuthzError, authzErrorResponse } from '@/lib/auth/authz';

// Block discovery against internal/cloud-metadata endpoints (SSRF hardening).
function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase();
  // IPv6 loopback / link-local / unique-local
  if (v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — strip prefix and fall through
  const v4 = v.startsWith('::ffff:') ? v.slice(7) : v;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true;                        // loopback
  if (a === 10) return true;                         // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 169 && b === 254) return true;            // link-local incl. 169.254.169.254 metadata
  if (a === 0) return true;
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new AuthzError(400, `Cannot resolve host: ${hostname}`);
  }
  if (addrs.length === 0) throw new AuthzError(400, `Cannot resolve host: ${hostname}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new AuthzError(400, 'Issuer resolves to a private/loopback/link-local address (blocked)');
    }
  }
}

// POST /api/settings/oidc/test  body: { issuerUrl }
export async function POST(request: NextRequest) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const raw = String(body.issuerUrl ?? '').trim();
    if (!raw) return NextResponse.json({ error: 'issuerUrl is required' }, { status: 400 });

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid issuerUrl' }, { status: 400 });
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return NextResponse.json({ error: 'issuerUrl must be http(s)' }, { status: 400 });
    }

    // SSRF guard: resolve host and block private/loopback addresses BEFORE any network call.
    await assertPublicHost(url.hostname);

    const clientId = String(body.clientId ?? 'discovery-test').trim() || 'discovery-test';

    // openid-client v6 DiscoveryRequestOptions.timeout is in seconds (default 30).
    const config = await client.discovery(url, clientId, undefined, undefined, {
      timeout: 10,
    });

    const meta = config.serverMetadata();
    if (!meta.authorization_endpoint || !meta.token_endpoint) {
      return NextResponse.json(
        { error: 'Discovery document missing authorization/token endpoints' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      issuer: meta.issuer,
      authorization_endpoint: meta.authorization_endpoint,
      token_endpoint: meta.token_endpoint,
      userinfo_endpoint: meta.userinfo_endpoint ?? null,
      jwks_uri: meta.jwks_uri ?? null,
    });
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Discovery failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
