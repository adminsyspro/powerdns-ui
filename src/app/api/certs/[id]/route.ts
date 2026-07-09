import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getCertificate, deleteCertificate, updateCertificateSettings } from '@/lib/certs/cert-store';
import { appendCertEvent } from '@/lib/certs/event-store';
import { removeMaterializedCert } from '@/lib/certs/materialize';
import { listActiveJobs } from '@/lib/certs/job-store';
import { logActivity, actorFromRequest } from '@/lib/activity/log';
import { deleteCertFromInfisical } from '@/lib/certs/infisical-sync';
import { isInfisicalEnabled } from '@/lib/certs/infisical-config';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(cert);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    if (body.autoRenew !== undefined && typeof body.autoRenew !== 'boolean') {
      return NextResponse.json({ error: 'autoRenew must be a boolean' }, { status: 400 });
    }
    if (
      body.renewBeforeDays !== undefined &&
      (typeof body.renewBeforeDays !== 'number' || !Number.isInteger(body.renewBeforeDays) || body.renewBeforeDays < 1)
    ) {
      return NextResponse.json({ error: 'renewBeforeDays must be a positive integer' }, { status: 400 });
    }
    if (body.keyDownloadEnabled !== undefined && typeof body.keyDownloadEnabled !== 'boolean') {
      return NextResponse.json({ error: 'keyDownloadEnabled must be a boolean' }, { status: 400 });
    }
    if (body.category !== undefined && body.category !== null && typeof body.category !== 'string') {
      return NextResponse.json({ error: 'category must be a string' }, { status: 400 });
    }
    if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 });
    }
    const updated = updateCertificateSettings(id, {
      autoRenew: body.autoRenew,
      renewBeforeDays: body.renewBeforeDays,
      keyDownloadEnabled: body.keyDownloadEnabled,
      category: body.category,
      comment: body.comment,
    });
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'update', resourceType: 'certificate',
      resourceId: id, resourceName: updated.name,
      details: [
        body.autoRenew !== undefined ? `autoRenew=${body.autoRenew}` : null,
        body.renewBeforeDays !== undefined ? `renewBeforeDays=${body.renewBeforeDays}` : null,
        body.keyDownloadEnabled !== undefined ? `keyDownload=${body.keyDownloadEnabled}` : null,
        body.category !== undefined ? 'category' : null,
        body.comment !== undefined ? 'comment' : null,
      ].filter(Boolean).join(', ') || 'settings',
    });
    return NextResponse.json(updated);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    const { id } = await params;
    const cert = getCertificate(id);
    if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (listActiveJobs(id).length > 0) {
      return NextResponse.json(
        { error: 'a job is active for this certificate; wait for it to finish' },
        { status: 409 }
      );
    }
    appendCertEvent({ certificateId: id, type: 'delete', status: 'ok', message: `certificate "${cert.name}" deleted` });
    deleteCertificate(id);
    if (isInfisicalEnabled()) {
      try { await deleteCertFromInfisical(cert.name); } catch { /* best-effort */ }
    }
    try {
      removeMaterializedCert(cert.name);
    } catch {
      // best-effort filesystem cleanup — DB row is already gone
    }
    logActivity({
      ...actorFromRequest(request, ctx),
      action: 'delete',
      resourceType: 'certificate',
      resourceId: cert.id,
      resourceName: cert.name,
      details: cert.sans.join(', '),
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
