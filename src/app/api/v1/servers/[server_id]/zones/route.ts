import { NextRequest, NextResponse } from 'next/server';
import { authenticateProxyRequest, isAuthError, logProxy } from '@/lib/proxy/auth';
import { filterZones, isReadOnly } from '@/lib/proxy/access-control';

// GET /api/v1/servers/[server_id]/zones — list zones filtered by permissions
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const auth = authenticateProxyRequest(request);
  if (isAuthError(auth)) {
    logProxy(request, 401, { startTime, error: 'Authentication failed' });
    return auth;
  }

  const { environment, connection } = auth;

  try {
    const response = await fetch(
      `${connection.url}/api/v1/servers/localhost/zones`,
      {
        headers: { 'X-API-Key': connection.apiKey },
      }
    );

    if (!response.ok) {
      logProxy(request, response.status, { environment, startTime, error: `PowerDNS error: ${response.status}` });
      return NextResponse.json(
        { error: `PowerDNS error: ${response.status}` },
        { status: response.status }
      );
    }

    const zones = await response.json();
    const filtered = filterZones(environment, zones);

    logProxy(request, 200, { environment, startTime });
    return NextResponse.json(filtered);
  } catch (e) {
    logProxy(request, 502, { environment, startTime, error: (e as Error).message });
    return NextResponse.json(
      { error: `Failed to connect to PowerDNS: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}

/** Ensure a DNS name ends with a dot (canonical/FQDN form required by PowerDNS) */
function canonicalize(name: string): string {
  return name.endsWith('.') ? name : `${name}.`;
}

// POST /api/v1/servers/[server_id]/zones — create a zone (full-access keys only)
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const auth = authenticateProxyRequest(request);
  if (isAuthError(auth)) {
    logProxy(request, 401, { startTime, error: 'Authentication failed' });
    return auth;
  }

  const { environment, connection } = auth;

  if (isReadOnly(environment)) {
    logProxy(request, 403, { environment, startTime, error: 'Read-only key' });
    return NextResponse.json({ error: 'This API key is read-only' }, { status: 403 });
  }

  if (environment.full_access !== 1) {
    logProxy(request, 403, { environment, startTime, error: 'Zone creation not allowed' });
    return NextResponse.json(
      { error: 'Zone creation is not allowed through the proxy' },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    logProxy(request, 400, { environment, startTime, error: 'Invalid JSON' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Canonicalize the zone name and any rrset names (PowerDNS requires trailing dots).
  if (body && typeof body.name === 'string') {
    body.name = canonicalize(body.name);
  }
  if (body && Array.isArray(body.rrsets)) {
    body.rrsets = body.rrsets.map((rrset: Record<string, unknown>) =>
      rrset.name ? { ...rrset, name: canonicalize(rrset.name as string) } : rrset
    );
  }

  try {
    const response = await fetch(
      `${connection.url}/api/v1/servers/localhost/zones`,
      {
        method: 'POST',
        headers: { 'X-API-Key': connection.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    const status = response.status;
    const data = await response.text();
    logProxy(request, status, { environment, zone: body?.name, startTime, requestBody: JSON.stringify(body) });
    return new NextResponse(data, {
      status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (e) {
    logProxy(request, 502, { environment, startTime, error: (e as Error).message, requestBody: JSON.stringify(body) });
    return NextResponse.json(
      { error: `Failed to connect to PowerDNS: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
