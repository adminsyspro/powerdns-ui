import { NextRequest, NextResponse } from 'next/server';
import { parseBind } from '@/lib/bind/parser';
import { pdnsProxy, getConnectionFromRequest, forwardPdnsResponse } from '@/lib/pdns-proxy';
import { getAuthContextFromHeaders, requireCreateInGroup, AuthzError, authzErrorResponse } from '@/lib/auth/authz';
import { autoProvisionZone } from '@/lib/integrations/sync';

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

export const maxDuration = 30;

interface CreateBody {
  content?: unknown;
  name?: unknown;
  kind?: unknown;
  nameservers?: unknown;
  masters?: unknown;
  account?: unknown;
  dnssec?: unknown;
  soa_edit_api?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    let body: CreateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const ctx = getAuthContextFromHeaders(request);
    const account = typeof body.account === 'string' ? body.account.trim() : '';
    requireCreateInGroup(ctx, account);
    body.account = account; // forward exactly the authorized account (prevents type-confusion)

    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }
    if (typeof body.name !== 'string' || !body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (typeof body.kind !== 'string') {
      return NextResponse.json({ error: 'kind is required' }, { status: 400 });
    }
    if (!Array.isArray(body.nameservers) || !body.nameservers.every((n) => typeof n === 'string')) {
      return NextResponse.json({ error: 'nameservers must be an array of strings' }, { status: 400 });
    }

    const contentBytes = new TextEncoder().encode(body.content).byteLength;
    if (contentBytes > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes` }, { status: 413 });
    }

    const zoneName = (body.name as string).endsWith('.') ? (body.name as string) : `${body.name}.`;

    // Re-parse server-side: never trust client-submitted rrsets.
    const preview = parseBind(body.content, zoneName);

    if (preview.rrsets.length === 0) {
      return NextResponse.json(
        { error: 'No valid records to import', warnings: preview.warnings, errors: preview.errors },
        { status: 422 },
      );
    }

    const pdnsBody: Record<string, unknown> = {
      name: zoneName,
      kind: body.kind,
      nameservers: body.nameservers,
      rrsets: preview.rrsets,
    };
    if (Array.isArray(body.masters)) pdnsBody.masters = body.masters;
    pdnsBody.account = account; // always forward the validated + authorized account
    if (typeof body.dnssec === 'boolean') pdnsBody.dnssec = body.dnssec;
    if (typeof body.soa_edit_api === 'string') pdnsBody.soa_edit_api = body.soa_edit_api;

    try {
      const conn = getConnectionFromRequest(request);
      const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`, {
        method: 'POST',
        body: JSON.stringify(pdnsBody),
      });
      if (response.ok) {
        // Best-effort: replicate the new zone to active integrations in scope.
        const canonical = zoneName.endsWith('.') ? zoneName : `${zoneName}.`;
        try {
          autoProvisionZone(conn.url, canonical, String(body.kind ?? ''), account);
        } catch { /* never block zone creation on integration errors */ }
      }
      return forwardPdnsResponse(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AuthzError) return authzErrorResponse(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
