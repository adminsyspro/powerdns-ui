import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'your-secret-key-change-in-production'
);
const COOKIE_NAME = 'pdns-session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/providers', '/api/auth/oidc/login', '/api/auth/oidc/callback'];
// Pages a non-Administrator may open. Everything else (admin pages, server
// pages, statistics, history, …) redirects them to /dashboard. API routes are
// NOT gated here — each handler enforces its own authorization (requireAdmin /
// zone scoping), so data the allowed pages need still loads.
const NON_ADMIN_PAGES = ['/dashboard', '/zones', '/profile'];
// Proxy paths use X-API-Key auth, not JWT — handled in route handlers
const PROXY_PATHS = ['/api/v1/', '/api/health/pdns', '/api/info/allowed'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Native PowerDNS API compatibility: rewrite paths for clients (lego/certbot)
  // that use PDNS_API_URL pointing directly at this server.
  // GET /api → /api/v1/servers/localhost (version check)
  // /servers/... → /api/v1/servers/... (zones, records, notify)
  const hasApiKey = request.headers.has('X-API-Key') || request.headers.has('x-api-key');
  if (hasApiKey) {
    if (pathname === '/api') {
      return NextResponse.rewrite(new URL('/api/v1/servers/localhost', request.url));
    }
    if (pathname.startsWith('/servers/')) {
      return NextResponse.rewrite(new URL(`/api/v1${pathname}`, request.url));
    }
  }

  // Skip public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Proxy API paths — bypass JWT, auth via X-API-Key in route handlers
  if (PROXY_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return handleUnauthorized(request);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;
    const userRole = payload.role as string;
    const groupSlugs = Array.isArray(payload.groupSlugs) ? (payload.groupSlugs as string[]) : [];
    const sessionVersion = typeof payload.sv === 'number' ? payload.sv : 0;
    const email = (payload.email as string) || '';

    // Role-based PAGE protection: non-Administrators may only open the
    // whitelisted pages. (API routes authorize themselves in their handlers.)
    if (userRole !== 'Administrator' && !pathname.startsWith('/api/')) {
      const allowed = NON_ADMIN_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'));
      if (!allowed) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }

    // Forward user info to API routes via request headers.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', userId);
    requestHeaders.set('x-user-role', userRole);
    requestHeaders.set('x-user-name', (payload.username as string) || '');
    requestHeaders.set('x-user-email', email);
    requestHeaders.set('x-user-groups', groupSlugs.join(','));
    requestHeaders.set('x-user-session-version', String(sessionVersion));
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    return response;
  } catch {
    return handleUnauthorized(request);
  }
}

function handleUnauthorized(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next (static files, images)
     * - favicon.ico, public assets
     */
    '/((?!_next|favicon\\.ico|powerdns-logo\\.png|avatars|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
