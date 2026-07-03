import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromHeaders, requireAdmin, requireAuth, authzErrorResponse, AuthzError } from '@/lib/auth/authz';
import { getGroupBySlug, updateGroup, deleteGroup } from '@/lib/cache/groups';
import { logActivity, clientIp } from '@/lib/activity/log';

// GET /api/groups/[slug] — group detail. Admin sees any; others only their own.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const { slug } = await params;
    if (ctx.role !== 'Administrator' && !ctx.groupSlugs.includes(slug)) {
      throw new AuthzError(403, 'Forbidden');
    }
    const group = getGroupBySlug(slug);
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    return NextResponse.json(group);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// PUT /api/groups/[slug] — update name/description (Administrator only). Slug is immutable.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = requireAdmin(request);
    const { slug } = await params;
    const body = await request.json();
    const fields: { name?: string; description?: string } = {};
    if (body.name !== undefined) fields.name = String(body.name).trim();
    if (body.description !== undefined) fields.description = String(body.description);
    if (fields.name !== undefined && fields.name === '') {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    const group = updateGroup(slug, fields);
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'group',
      resourceId: slug, resourceName: group.name,
      details: null,
    });
    return NextResponse.json(group);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// DELETE /api/groups/[slug] — delete group + its memberships (Administrator only).
// Zones keep their account value (becoming admin-only-visible); the response
// reports how many zones still reference the slug so the UI can warn.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = requireAdmin(request);
    const { slug } = await params;
    const result = deleteGroup(slug);
    if (!result.deleted) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'delete', resourceType: 'group',
      resourceId: slug, resourceName: slug,
      details: result.zoneCount ? `${result.zoneCount} zone(s) orphaned` : null,
    });
    return NextResponse.json({ success: true, orphanedZoneCount: result.zoneCount });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
