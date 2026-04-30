import { NextRequest, NextResponse } from 'next/server';
import { parseBind } from '@/lib/bind/parser';
import { pdnsProxy, getConnectionFromRequest, forwardPdnsResponse } from '@/lib/pdns-proxy';

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

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
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator' && role !== 'Operator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

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
  if (typeof body.account === 'string') pdnsBody.account = body.account;
  if (typeof body.dnssec === 'boolean') pdnsBody.dnssec = body.dnssec;
  if (typeof body.soa_edit_api === 'string') pdnsBody.soa_edit_api = body.soa_edit_api;

  try {
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`, {
      method: 'POST',
      body: JSON.stringify(pdnsBody),
    });
    return forwardPdnsResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
