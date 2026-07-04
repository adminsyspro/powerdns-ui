import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse, type AuthContext } from '@/lib/auth/authz';
import { isCertsEnabled, isInternalCaEnabled, certSecretsMisconfigured } from '@/lib/certs/config';
import { runInternalCaSetup } from '@/lib/certs/internal-ca';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

export async function POST(request: NextRequest) {
  if (!isCertsEnabled() || !isInternalCaEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (certSecretsMisconfigured()) {
    return NextResponse.json({ error: 'Certificate operations are disabled: set APP_SECRET (or AUTH_SECRET) so secrets are not stored under the public default key.' }, { status: 503 });
  }
  let ctx: AuthContext;
  try {
    ctx = requireAdmin(request);
  } catch (e) {
    return authzErrorResponse(e);
  }
  try {
    const account = await runInternalCaSetup();
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'acme_account',
      resourceId: account.id, resourceName: account.name,
      details: `internal CA setup (${account.status})`,
    });
    return NextResponse.json(account);
  } catch (e: unknown) {
    const retryable = typeof e === 'object' && e !== null && (e as { retryable?: boolean }).retryable === true;
    const message = e instanceof Error ? e.message : 'setup failed';
    return NextResponse.json({ error: message }, { status: retryable ? 503 : 400 });
  }
}
