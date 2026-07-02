import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { createAcmeAccount, listAcmeAccounts } from '@/lib/certs/store';
import type { CaType, PropagationMode } from '@/lib/certs/types';

const CA_TYPES: CaType[] = ['letsencrypt', 'step-ca', 'other'];
const PROP_MODES: PropagationMode[] = ['authoritative', 'resolver', 'delay'];

function validateHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
    return NextResponse.json(listAcmeAccounts());
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    requireAdmin(request);
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
    const directoryUrl = String(body.directoryUrl ?? '').trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!validateHttpsUrl(directoryUrl))
      return NextResponse.json({ error: 'directoryUrl must be a valid https URL' }, { status: 400 });
    if (body.caType !== undefined && !CA_TYPES.includes(body.caType))
      return NextResponse.json({ error: 'invalid caType' }, { status: 400 });
    const caType: CaType = body.caType ?? 'letsencrypt';
    if (body.propagationMode !== undefined && !PROP_MODES.includes(body.propagationMode))
      return NextResponse.json({ error: 'invalid propagationMode' }, { status: 400 });
    const propagationMode: PropagationMode = body.propagationMode ?? 'authoritative';
    try {
      const account = createAcmeAccount({
        name, caType, directoryUrl,
        contactEmail: body.contactEmail ? String(body.contactEmail) : '',
        eabKid: body.eabKid ? String(body.eabKid) : null,
        eabHmacKey: body.eabHmacKey ? String(body.eabHmacKey) : null,
        rootPem: body.rootPem ? String(body.rootPem) : null,
        rootFingerprintSha256: body.rootFingerprintSha256 ? String(body.rootFingerprintSha256) : null,
        propagationMode,
        propagationResolver: body.propagationResolver ? String(body.propagationResolver) : null,
        tosAgreed: body.tosAgreed === true,
      });
      return NextResponse.json(account, { status: 201 });
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
