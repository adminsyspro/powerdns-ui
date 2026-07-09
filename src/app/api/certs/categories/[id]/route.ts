import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCategory, updateCategory, deleteCategory } from '@/lib/certs/category-store';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const updated = updateCategory(id, { name: body.name, description: body.description });
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'certificate_category',
      resourceId: id, resourceName: updated.name,
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof Error && e.message.includes('already exists')) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return authzErrorResponse(e);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const cat = getCategory(id);
    if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    deleteCategory(id);
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'delete', resourceType: 'certificate_category',
      resourceId: id, resourceName: cat.name,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes('cannot be deleted')) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return authzErrorResponse(e);
  }
}
