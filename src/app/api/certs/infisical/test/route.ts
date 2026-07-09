import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { testInfisicalConnection } from '@/lib/certs/infisical-sync';

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const result = await testInfisicalConnection();
    return NextResponse.json(result);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
