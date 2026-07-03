import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getDb } from '@/lib/cache/db';
import { listUserGroups, replaceManualUserGroups } from '@/lib/cache/groups';
import { logActivity, clientIp } from '@/lib/activity/log';

// GET /api/users/[id]/groups — the user's group memberships with their source (Administrator only).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(listUserGroups(id));
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// PUT /api/users/[id]/groups — replace the user's MANUAL memberships (Administrator only).
// Body: { groupSlugs: string[] }. LDAP/OIDC memberships are left untouched.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = requireAdmin(request);
    const { id } = await params;
    const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const body = await request.json();
    if (!Array.isArray(body.groupSlugs)) {
      return NextResponse.json({ error: 'groupSlugs must be an array' }, { status: 400 });
    }
    const slugs = body.groupSlugs.map((s: unknown) => String(s));
    const applied = replaceManualUserGroups(id, slugs);
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'user',
      resourceId: id, resourceName: null,
      details: `groups: ${applied.join(', ') || '(none)'}`,
    });
    return NextResponse.json(listUserGroups(id));
  } catch (e) {
    return authzErrorResponse(e);
  }
}
