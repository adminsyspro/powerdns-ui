import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromHeaders, requireAdmin, requireAuth, canSeeAllZones, authzErrorResponse } from '@/lib/auth/authz';
import { listGroups, listGroupsBySlugs, getGroupRowBySlug, createGroup, isValidSlug } from '@/lib/cache/groups';

// GET /api/groups — Administrators and Operators see all groups (they manage all
// zones, so they need every account for the zone group picker/filter); Users and
// Customers see only their own.
export async function GET(request: NextRequest) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const groups = canSeeAllZones(ctx.role) ? listGroups() : listGroupsBySlugs(ctx.groupSlugs);
    return NextResponse.json(groups);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// POST /api/groups — create a group (Administrator only).
export async function POST(request: NextRequest) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const slug = String(body.slug ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '');
    if (!slug || !name) {
      return NextResponse.json({ error: 'slug and name are required' }, { status: 400 });
    }
    if (!isValidSlug(slug)) {
      return NextResponse.json(
        { error: 'slug must match ^[a-z0-9-]+$ and be at most 64 characters' },
        { status: 400 }
      );
    }
    if (getGroupRowBySlug(slug)) {
      return NextResponse.json({ error: 'A group with this slug already exists' }, { status: 409 });
    }
    const group = createGroup(slug, name, description);
    return NextResponse.json(group, { status: 201 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
