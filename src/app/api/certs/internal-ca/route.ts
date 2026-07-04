import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled, isInternalCaEnabled } from '@/lib/certs/config';
import { internalCaStatus } from '@/lib/certs/internal-ca';

export async function GET(request: NextRequest) {
  try {
    if (!isCertsEnabled() || !isInternalCaEnabled()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    requireAdmin(request);
    return NextResponse.json(internalCaStatus());
  } catch (e) {
    return authzErrorResponse(e);
  }
}
