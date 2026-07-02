import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getAcmeAccount, updateAcmeAccount, deleteAcmeAccount } from '@/lib/certs/store';
import { certificatesUsingAccount } from '@/lib/certs/cert-store';
import type { PropagationMode } from '@/lib/certs/types';

type RouteContext = { params: Promise<{ id: string }> };
const PROP_MODES: PropagationMode[] = ['authoritative', 'resolver', 'delay'];

function validateHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    const account = getAcmeAccount(id);
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(account);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
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
    if (body.name !== undefined && String(body.name).trim() === '')
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    if (body.propagationMode !== undefined && !PROP_MODES.includes(body.propagationMode))
      return NextResponse.json({ error: 'invalid propagationMode' }, { status: 400 });
    if (body.directoryUrl !== undefined && !validateHttpsUrl(String(body.directoryUrl)))
      return NextResponse.json({ error: 'directoryUrl must be a valid https URL' }, { status: 400 });
    try {
      const updated = updateAcmeAccount(id, {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        contactEmail: body.contactEmail !== undefined ? String(body.contactEmail) : undefined,
        directoryUrl: body.directoryUrl !== undefined ? String(body.directoryUrl).trim() : undefined,
        eabKid: body.eabKid !== undefined ? (body.eabKid ? String(body.eabKid) : null) : undefined,
        eabHmacKey: body.eabHmacKey !== undefined ? (body.eabHmacKey ? String(body.eabHmacKey) : null) : undefined,
        rootPem: body.rootPem !== undefined ? (body.rootPem ? String(body.rootPem) : null) : undefined,
        rootFingerprintSha256: body.rootFingerprintSha256 !== undefined ? (body.rootFingerprintSha256 ? String(body.rootFingerprintSha256) : null) : undefined,
        propagationMode: body.propagationMode,
        propagationResolver: body.propagationResolver !== undefined ? (body.propagationResolver ? String(body.propagationResolver) : null) : undefined,
        tosAgreed: body.tosAgreed !== undefined ? body.tosAgreed === true : undefined,
      });
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(updated);
    } catch (err: any) {
      // UNIQUE(name) collision etc.
      if (String(err?.message).includes('UNIQUE'))
        return NextResponse.json({ error: 'An account with that name already exists' }, { status: 409 });
      throw err;
    }
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    const { id } = await params;
    const inUse = certificatesUsingAccount(id);
    if (inUse > 0) {
      return NextResponse.json(
        { error: `Account is used by ${inUse} certificate(s); delete those first` },
        { status: 409 }
      );
    }
    if (!deleteAcmeAccount(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
