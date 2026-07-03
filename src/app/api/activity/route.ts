import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { listActivity } from '@/lib/activity/log';

// GET /api/activity — paginated activity/audit log (Administrator only).
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const p = new URL(request.url).searchParams;
    return NextResponse.json(listActivity({
      page: Number(p.get('page')) || 1,
      pageSize: Number(p.get('pageSize')) || 50,
      action: p.get('action') || undefined,
      resourceType: p.get('resourceType') || undefined,
      actor: p.get('actor') || undefined,
      search: p.get('search') || undefined,
    }));
  } catch (e) {
    return authzErrorResponse(e);
  }
}
