import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled, certSecretsMisconfigured } from '@/lib/certs/config';
import { getAcmeAccount, updateAcmeAccount, deleteAcmeAccountIfUnused } from '@/lib/certs/store';
import type { PropagationMode } from '@/lib/certs/types';
import { logActivity, actorFromRequest } from '@/lib/activity/log';
import { parseSingleCaRoot } from '@/lib/certs/acme-trust';

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
    if (certSecretsMisconfigured()) {
      return NextResponse.json({ error: 'Certificate operations are disabled: set APP_SECRET (or AUTH_SECRET) so secrets are not stored under the public default key.' }, { status: 503 });
    }
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
    if (body.name !== undefined && String(body.name).trim() === '')
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    if (body.propagationMode !== undefined && !PROP_MODES.includes(body.propagationMode))
      return NextResponse.json({ error: 'invalid propagationMode' }, { status: 400 });
    if (body.directoryUrl !== undefined && !validateHttpsUrl(String(body.directoryUrl)))
      return NextResponse.json({ error: 'directoryUrl must be a valid https URL' }, { status: 400 });
    let rootPemPatch: string | null | undefined =
      body.rootPem !== undefined ? (body.rootPem ? String(body.rootPem) : null) : undefined;
    let rootFpPatch: string | null | undefined =
      body.rootFingerprintSha256 !== undefined ? (body.rootFingerprintSha256 ? String(body.rootFingerprintSha256) : null) : undefined;
    if (typeof rootPemPatch === 'string' && rootPemPatch.trim() !== '') {
      try {
        const parsed = parseSingleCaRoot(rootPemPatch);
        rootPemPatch = parsed.pem;
        rootFpPatch = parsed.fingerprint;
      } catch (e) {
        return NextResponse.json({ error: `invalid root PEM: ${e instanceof Error ? e.message : 'parse error'}` }, { status: 400 });
      }
    }
    try {
      const updated = updateAcmeAccount(id, {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        contactEmail: body.contactEmail !== undefined ? String(body.contactEmail) : undefined,
        directoryUrl: body.directoryUrl !== undefined ? String(body.directoryUrl).trim() : undefined,
        eabKid: body.eabKid !== undefined ? (body.eabKid ? String(body.eabKid) : null) : undefined,
        eabHmacKey: body.eabHmacKey !== undefined ? (body.eabHmacKey ? String(body.eabHmacKey) : null) : undefined,
        rootPem: rootPemPatch,
        rootFingerprintSha256: rootFpPatch,
        propagationMode: body.propagationMode,
        propagationResolver: body.propagationResolver !== undefined ? (body.propagationResolver ? String(body.propagationResolver) : null) : undefined,
        tosAgreed: body.tosAgreed !== undefined ? body.tosAgreed === true : undefined,
      });
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      logActivity({
        ...actorFromRequest(request, ctx),
        action: 'update', resourceType: 'acme_account',
        resourceId: id, resourceName: updated.name,
        details: `${updated.caType} @ ${updated.directoryUrl}`,
      });
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
    const ctx = requireAdmin(request);
    const { id } = await params;
    const account = getAcmeAccount(id);
    const outcome = deleteAcmeAccountIfUnused(id);
    if (outcome.result === 'not-found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (outcome.result === 'in-use') {
      return NextResponse.json(
        { error: `Account is used by ${outcome.inUse} certificate(s); delete those first` },
        { status: 409 }
      );
    }
    if (outcome.result === 'deleted') {
      logActivity({
        ...actorFromRequest(request, ctx),
        action: 'delete', resourceType: 'acme_account',
        resourceId: id, resourceName: account?.name ?? id,
        details: null,
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
