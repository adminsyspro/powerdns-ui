import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'your-secret-key-change-in-production'
);
const COOKIE_NAME = 'pdns-session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/providers'];
const ADMIN_PATHS = ['/users', '/settings', '/proxy'];
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

    // Role-based page protection
    if (ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      if (userRole !== 'Administrator') {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }

    // Forward user info to API routes via headers
    const response = NextResponse.next();
    response.headers.set('x-user-id', userId);
    response.headers.set('x-user-role', userRole);
    response.headers.set('x-user-name', (payload.username as string) || '');
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
