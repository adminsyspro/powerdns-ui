import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getGroupRowBySlug, removeManualMember } from '@/lib/cache/groups';
import { logActivity, clientIp } from '@/lib/activity/log';

// DELETE /api/groups/[slug]/members/[userId] — remove a MANUAL membership only.
// 409 if the user's membership comes solely from LDAP/OIDC (not hand-removable).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; userId: string }> }
) {
  try {
    const ctx = requireAdmin(request);
    const { slug, userId } = await params;
    const group = getGroupRowBySlug(slug);
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    const result = removeManualMember(group.id, userId);
    if (!result.removed) {
      if (result.conflictSource) {
        return NextResponse.json(
          { error: `Membership is managed by ${result.conflictSource} and cannot be removed manually` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
    }
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'group',
      resourceId: slug, resourceName: group.name,
      details: `removed member ${userId}`,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
