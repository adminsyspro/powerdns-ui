import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { syncAllCertsToInfisical } from '@/lib/certs/infisical-sync';

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const summary = await syncAllCertsToInfisical();
    return NextResponse.json(summary);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
