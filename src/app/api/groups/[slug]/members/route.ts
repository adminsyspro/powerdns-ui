import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getDb } from '@/lib/cache/db';
import { getGroupRowBySlug, listMembers, addManualMember } from '@/lib/cache/groups';
import { logActivity, clientIp } from '@/lib/activity/log';

// GET /api/groups/[slug]/members — list members (Administrator only).
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireAdmin(request);
    const { slug } = await params;
    const group = getGroupRowBySlug(slug);
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    return NextResponse.json(listMembers(group.id));
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// POST /api/groups/[slug]/members — add a manual member (Administrator only). Body: { userId }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = requireAdmin(request);
    const { slug } = await params;
    const group = getGroupRowBySlug(slug);
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    const body = await request.json();
    const userId = String(body.userId ?? '');
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    addManualMember(group.id, userId);
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'group',
      resourceId: slug, resourceName: group.name,
      details: `added member ${userId}`,
    });
    return NextResponse.json(listMembers(group.id), { status: 201 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
