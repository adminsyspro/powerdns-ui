import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromHeaders, requireAuth, authzErrorResponse, AuthzError } from '@/lib/auth/authz';
import { getGroupRowBySlug, listZonesByAccount } from '@/lib/cache/groups';

// GET /api/groups/[slug]/zones — cached zones whose account = slug.
// Administrators may read any group; others only groups they belong to.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const { slug } = await params;
    if (ctx.role !== 'Administrator' && !ctx.groupSlugs.includes(slug)) {
      throw new AuthzError(403, 'Forbidden');
    }
    if (!getGroupRowBySlug(slug)) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    return NextResponse.json(listZonesByAccount(slug));
  } catch (e) {
    return authzErrorResponse(e);
  }
}
