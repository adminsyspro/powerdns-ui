import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCertificate } from '@/lib/certs/cert-store';
import { listCertEvents } from '@/lib/certs/event-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    if (!getCertificate(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(listCertEvents(id, 100));
  } catch (e) {
    return authzErrorResponse(e);
  }
}
