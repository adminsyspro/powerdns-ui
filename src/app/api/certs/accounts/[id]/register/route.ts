import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { registerAccount } from '@/lib/certs/acme-account';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    requireAdmin(request);
  } catch (e) {
    return authzErrorResponse(e);
  }
  try {
    const { id } = await params;
    const account = await registerAccount(id);
    return NextResponse.json(account);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'registration failed';
    const status = message === 'account not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
