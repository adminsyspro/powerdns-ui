import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCertificate } from '@/lib/certs/cert-store';
import { enqueueJob } from '@/lib/certs/job-store';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    if (!getCertificate(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = enqueueJob(id, 'issue');
    if ('alreadyActive' in result) {
      return NextResponse.json({ error: 'an issuance/renewal job is already active' }, { status: 409 });
    }
    return NextResponse.json({ jobId: result.id }, { status: 202 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
