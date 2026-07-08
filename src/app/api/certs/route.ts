import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { createCertificate, listCertificates } from '@/lib/certs/cert-store';
import { enqueueJob } from '@/lib/certs/job-store';
import { connectionExists } from '@/lib/integrations/connections';
import { logActivity, actorFromRequest } from '@/lib/activity/log';
import type { KeyType } from '@/lib/certs/types';

const KEY_TYPES: KeyType[] = ['ecdsa', 'rsa'];

export async function GET(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    return NextResponse.json(listCertificates());
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ctx = requireAdmin(request);
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const acmeAccountId = String(body.acmeAccountId ?? '');
    if (!acmeAccountId) return NextResponse.json({ error: 'acmeAccountId is required' }, { status: 400 });
    const connectionId = String(body.connectionId ?? '');
    if (!connectionId) return NextResponse.json({ error: 'connectionId is required' }, { status: 400 });
    if (!connectionExists(connectionId)) {
      return NextResponse.json({ error: 'connection not found' }, { status: 400 });
    }
    if (!Array.isArray(body.sans) || body.sans.length === 0) {
      return NextResponse.json({ error: 'sans must be a non-empty array' }, { status: 400 });
    }
    if (body.keyType !== undefined && !KEY_TYPES.includes(body.keyType)) {
      return NextResponse.json({ error: 'invalid keyType' }, { status: 400 });
    }
    if (body.autoRenew !== undefined && typeof body.autoRenew !== 'boolean') {
      return NextResponse.json({ error: 'autoRenew must be a boolean' }, { status: 400 });
    }
    if (
      body.renewBeforeDays !== undefined &&
      (typeof body.renewBeforeDays !== 'number' ||
        !Number.isInteger(body.renewBeforeDays) ||
        body.renewBeforeDays < 1 ||
        body.renewBeforeDays > 90)
    ) {
      return NextResponse.json({ error: 'renewBeforeDays must be an integer between 1 and 90' }, { status: 400 });
    }
    if (body.category !== undefined && typeof body.category !== 'string') {
      return NextResponse.json({ error: 'category must be a string' }, { status: 400 });
    }
    if (body.comment !== undefined && typeof body.comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 });
    }
    try {
      const cert = createCertificate({
        name,
        acmeAccountId,
        connectionId,
        sans: body.sans,
        keyType: body.keyType as KeyType | undefined,
        autoRenew: body.autoRenew === undefined ? undefined : body.autoRenew,
        renewBeforeDays: body.renewBeforeDays,
        category: body.category,
        comment: body.comment,
      });
      // Kick off ACME issuance immediately — creating a certificate should start
      // it (the worker drains the job). Best-effort: if enqueue fails the cert
      // still exists and can be issued from the UI ("Issue now").
      try { enqueueJob(cert.id, 'issue'); } catch { /* non-fatal: issue manually */ }
      logActivity({
        ...actorFromRequest(request, ctx),
        action: 'create',
        resourceType: 'certificate',
        resourceId: cert.id,
        resourceName: cert.name,
        details: cert.sans.join(', '),
      });
      return NextResponse.json(cert, { status: 201 });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      if (msg.includes('UNIQUE')) {
        return NextResponse.json({ error: 'A certificate with that name already exists' }, { status: 409 });
      }
      if (msg.includes('same domains')) {
        return NextResponse.json({ error: 'A certificate with the same domains already exists' }, { status: 409 });
      }
      if (
        msg.startsWith('invalid SAN') ||
        msg.includes('at least one SAN') ||
        msg.includes('too many SANs') ||
        msg.startsWith('invalid certificate name') ||
        msg === 'unknown acme_account_id' ||
        msg.startsWith('connection not found')
      ) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      throw err;
    }
  } catch (e) {
    return authzErrorResponse(e);
  }
}
