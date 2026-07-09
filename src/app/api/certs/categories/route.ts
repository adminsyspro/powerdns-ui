import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { listCategories, createCategory } from '@/lib/certs/category-store';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

export function GET(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    return NextResponse.json(listCategories());
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const body = await request.json();
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const cat = createCategory({ name: body.name, description: body.description });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'create', resourceType: 'certificate_category',
      resourceId: cat.id, resourceName: cat.name,
    });
    return NextResponse.json(cat, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes('already exists')) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return authzErrorResponse(e);
  }
}
