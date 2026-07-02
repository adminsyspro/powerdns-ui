import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { getAcmeAccount, updateAcmeAccount, deleteAcmeAccount } from '@/lib/certs/store';
import type { PropagationMode } from '@/lib/certs/types';

type RouteContext = { params: Promise<{ id: string }> };
const PROP_MODES: PropagationMode[] = ['authoritative', 'resolver', 'delay'];

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    requireAdmin(request);
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { id } = await params;
    const body = await request.json();
    if (body.propagationMode !== undefined && !PROP_MODES.includes(body.propagationMode))
      return NextResponse.json({ error: 'invalid propagationMode' }, { status: 400 });
    if (body.directoryUrl !== undefined && !/^https:\/\//.test(String(body.directoryUrl)))
      return NextResponse.json({ error: 'directoryUrl must be an https URL' }, { status: 400 });
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
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { id } = await params;
    if (!deleteAcmeAccount(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
