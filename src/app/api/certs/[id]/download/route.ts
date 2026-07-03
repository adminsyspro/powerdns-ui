import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCertificate, getCertificateBundle, getCertificatePrivateKey } from '@/lib/certs/cert-store';
import { appendCertEvent } from '@/lib/certs/event-store';

type RouteContext = { params: Promise<{ id: string }> };

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function pemFile(body: string, filename: string, extraHeaders: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}

// GET → public fullchain (leaf + chain). Non-sensitive (sent in every TLS
// handshake), so NOT gated by key_download_enabled. Admin-only like the rest.
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const bundle = getCertificateBundle(id);
    if (!bundle) return NextResponse.json({ error: 'certificate not issued yet' }, { status: 404 });
    const fullchain = [bundle.certPem, bundle.chainPem].filter(Boolean).join('\n');
    return pemFile(fullchain, `${cert.name}-fullchain.pem`);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// POST → private-key bundle (key + fullchain). Audited (actor/IP), no-store,
// refused when key download is disabled for this cert.
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!cert.keyDownloadEnabled) {
      return NextResponse.json({ error: 'private key download is disabled for this certificate' }, { status: 403 });
    }
    const bundle = getCertificateBundle(id);
    const privkey = getCertificatePrivateKey(id);
    if (!bundle || !privkey) {
      return NextResponse.json({ error: 'certificate not issued yet' }, { status: 404 });
    }
    // Audit BEFORE returning the material.
    appendCertEvent({
      certificateId: id,
      type: 'download',
      status: 'ok',
      actor: ctx.username,
      actorIp: clientIp(request),
      message: 'private key bundle downloaded',
    });
    const body = [privkey, bundle.certPem, bundle.chainPem].filter(Boolean).join('\n');
    return pemFile(body, `${cert.name}-bundle.pem`, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
