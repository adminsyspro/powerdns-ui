import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { getDb } from '@/lib/cache/db';

// DELETE /api/users/[id]/sessions — force-logout (Administrator only).
// Increments users.session_version so the user's outstanding JWT (which carries
// the old sv) is rejected by getAuthContextFromHeaders on its next request.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(request);
    const { id } = await params;
    const result = getDb()
      .prepare('UPDATE users SET session_version = session_version + 1, updated_at = unixepoch() WHERE id = ?')
      .run(id);
    if (result.changes === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
