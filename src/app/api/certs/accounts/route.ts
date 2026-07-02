import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authzErrorResponse } from '@/lib/auth/authz';
import { isCertsEnabled } from '@/lib/certs/config';
import { createAcmeAccount, listAcmeAccounts } from '@/lib/certs/store';
import type { CaType, PropagationMode } from '@/lib/certs/types';

const CA_TYPES: CaType[] = ['letsencrypt', 'step-ca', 'other'];
const PROP_MODES: PropagationMode[] = ['authoritative', 'resolver', 'delay'];

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(listAcmeAccounts());
  } catch (e) {
    return authzErrorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAdmin(request);
    if (!isCertsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    const directoryUrl = String(body.directoryUrl ?? '').trim();
    const caType: CaType = CA_TYPES.includes(body.caType) ? body.caType : 'letsencrypt';
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!/^https:\/\//.test(directoryUrl))
      return NextResponse.json({ error: 'directoryUrl must be an https URL' }, { status: 400 });
    const propagationMode: PropagationMode = PROP_MODES.includes(body.propagationMode) ? body.propagationMode : 'authoritative';
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
