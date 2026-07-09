import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { testInfisicalConnection } from '@/lib/certs/infisical-sync';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const result = await testInfisicalConnection();
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'test', resourceType: 'infisical_config',
      resourceName: 'infisical',
      details: `ok=${result.ok}${result.error ? `, error=${result.error}` : ''}`,
    });
    return NextResponse.json(result);
  } catch (e) {
    return authzErrorResponse(e);
  }
}
