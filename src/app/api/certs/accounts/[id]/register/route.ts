import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse, type AuthContext } from '@/lib/auth/authz';
import { isCertsEnabled, certSecretsMisconfigured } from '@/lib/certs/config';
import { registerAccount } from '@/lib/certs/acme-account';
import { logActivity, actorFromRequest } from '@/lib/activity/log';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    const { id } = await params;
    const account = await registerAccount(id);
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'acme_account',
      resourceId: id, resourceName: account.name,
      details: `registered (${account.status})`,
    });
    return NextResponse.json(account);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'registration failed';
    const status = message === 'account not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
