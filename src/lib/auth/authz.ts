import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import type { UserRole } from '@/types/powerdns';

export type ZoneAction = 'read' | 'write-records' | 'write-zone';

export interface AuthContext {
  userId: string;
  username: string;
  role: UserRole;
  groupSlugs: string[];
}

/** Thrown by the require* helpers; convert to a response with authzErrorResponse(). */
export class AuthzError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthzError';
    this.status = status;
  }
}

/**
 * Build the per-request auth context from the headers the middleware injected,
 * and enforce the force-logout (session_version) check against the DB. Returns
 * null when the request is unauthenticated, the user is gone/disabled, or the
 * session has been revoked (JWT sv != current users.session_version).
 *
 * Runs in the Node runtime (route handlers) — it touches better-sqlite3, which
 * the Edge middleware cannot. This is why the sv check lives here, not in
 * middleware (spec §6.2 deviation, documented).
 */
export function getAuthContextFromHeaders(req: NextRequest): AuthContext | null {
  // SECURITY: the x-user-* headers read below are authoritative ONLY because the
  // Edge middleware (src/middleware.ts) overwrites any client-supplied values with
  // the verified JWT claims on every request (via requestHeaders.set(...)), and the
  // zone/groups/users API routes are not in the middleware's PUBLIC/PROXY bypass
  // lists. Never call this helper from a path that bypasses middleware — the values
  // would become client-spoofable and the session_version revocation check below
  // would be defeated.
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role') as UserRole | null;
  const username = req.headers.get('x-user-name') ?? '';
  if (!userId || !role) return null;

  const groupSlugs = (req.headers.get('x-user-groups') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const headerSv = Number(req.headers.get('x-user-session-version') ?? '0');
  const row = getDb()
    .prepare('SELECT session_version FROM users WHERE id = ? AND active = 1')
    .get(userId) as { session_version: number } | undefined;
  if (!row || row.session_version !== headerSv) return null;

  return { userId, username, role, groupSlugs };
}

export function requireAuth(ctx: AuthContext | null): AuthContext {
  if (!ctx) throw new AuthzError(401, 'Unauthorized');
  return ctx;
}

export function requireRole(ctx: AuthContext | null, ...roles: UserRole[]): AuthContext {
  const c = requireAuth(ctx);
  if (!roles.includes(c.role)) throw new AuthzError(403, 'Forbidden');
  return c;
}

/**
 * One-call admin gate for route handlers: extracts the AuthContext from the
 * middleware-set headers (which also enforces the session_version force-logout
 * check against the DB) and requires the Administrator role. Throws AuthzError
 * (401 if unauthenticated/revoked, 403 if not an Administrator). Use in a
 * try/catch with authzErrorResponse(e).
 */
export function requireAdmin(req: NextRequest): AuthContext {
  return requireRole(getAuthContextFromHeaders(req), 'Administrator');
}

/** Administrators see every zone regardless of account; everyone else is group-scoped. */
export function canSeeAllZones(role: UserRole): boolean {
  return role === 'Administrator';
}

/**
 * Core decision: may this context perform `action` on a zone owned by `account`?
 * Non-admins are scoped to their group slugs; orphan zones (account === '') are
 * Administrator-only. Mirrors the permission matrix in spec §5.
 */
export function canAccessZone(ctx: AuthContext, account: string, action: ZoneAction): boolean {
  if (ctx.role === 'Administrator') return true;
  if (!account || !ctx.groupSlugs.includes(account)) return false;
  switch (action) {
    case 'read':
      return true; // Operator / User / Customer may all read within their groups
    case 'write-records':
      return ctx.role === 'Operator' || ctx.role === 'Customer';
    case 'write-zone':
      return ctx.role === 'Operator';
    default:
      return false;
  }
}

export function requireZoneAccess(
  ctx: AuthContext | null,
  zone: { account: string | null | undefined },
  action: ZoneAction
): AuthContext {
  const c = requireAuth(ctx);
  if (!canAccessZone(c, zone.account ?? '', action)) throw new AuthzError(403, 'Forbidden');
  return c;
}

/**
 * Gate for zone creation, where there is no existing zone to scope against.
 * Administrators may target any account (including '' / orphan). Operators may
 * only create within one of their own groups. Everyone else is rejected.
 */
export function requireCreateInGroup(ctx: AuthContext | null, account: string): AuthContext {
  const c = requireRole(ctx, 'Administrator', 'Operator');
  if (c.role === 'Administrator') return c;
  if (!account || !c.groupSlugs.includes(account)) {
    throw new AuthzError(403, 'Operators can only create zones in their own groups');
  }
  return c;
}

const ZONE_LEVEL_TYPES = new Set([
  'SOA', 'DNSKEY', 'DS', 'RRSIG', 'NSEC', 'NSEC3', 'NSEC3PARAM', 'CDS', 'CDNSKEY',
]);

function normalizeName(n: string): string {
  const t = (n ?? '').trim().toLowerCase();
  return t.endsWith('.') ? t : `${t}.`;
}

/**
 * True if any rrset in a PATCH touches zone-level structure — apex NS, SOA, or
 * any DNSSEC record. Customers may edit ordinary records but never these. Child
 * NS records (delegations under the apex) are record-level and are allowed.
 * Spec §6.4.
 */
export function isZoneLevelPatch(
  rrsets: Array<{ type: string; name: string }>,
  apex: string
): boolean {
  const apexN = normalizeName(apex);
  return rrsets.some((r) => {
    const type = (r.type ?? '').toUpperCase();
    if (ZONE_LEVEL_TYPES.has(type)) return true;
    return type === 'NS' && normalizeName(r.name) === apexN;
  });
}

/**
 * In a route's catch block: turn an AuthzError into JSON; re-throw anything else.
 * Callers MUST use `return authzErrorResponse(e)` — the `return` is required for the
 * 401/403 to short-circuit the handler. Non-AuthzError values are re-thrown so genuine
 * bugs still surface to Next.js's error boundary.
 */
export function authzErrorResponse(e: unknown): NextResponse {
  if (e instanceof AuthzError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}
