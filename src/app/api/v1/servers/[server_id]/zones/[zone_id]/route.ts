import { NextRequest, NextResponse } from 'next/server';
import { authenticateProxyRequest, isAuthError, logProxy } from '@/lib/proxy/auth';
import { isZoneAllowed, filterRRSets, validatePatchPayload } from '@/lib/proxy/access-control';

// GET /api/v1/servers/[server_id]/zones/[zone_id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ server_id: string; zone_id: string }> }
) {
  const startTime = Date.now();
  const auth = authenticateProxyRequest(request);
  if (isAuthError(auth)) {
    logProxy(request, 401, { startTime, error: 'Authentication failed' });
    return auth;
  }

  const { environment, connection } = auth;
  const { zone_id } = await params;

  const zonePerm = isZoneAllowed(environment.id, zone_id);
  if (!zonePerm) {
    logProxy(request, 403, { environment, zone: zone_id, startTime, error: 'Zone not allowed' });
    return NextResponse.json({ error: 'Zone not allowed' }, { status: 403 });
  }

  try {
    const response = await fetch(
      `${connection.url}/api/v1/servers/localhost/zones/${zone_id}`,
      { headers: { 'X-API-Key': connection.apiKey } }
    );

    if (!response.ok) {
      const text = await response.text();
      logProxy(request, response.status, { environment, zone: zone_id, startTime, error: `PowerDNS: ${response.status}` });
      return new NextResponse(text, {
        status: response.status,
        headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
      });
    }

    const zone = await response.json();
    if (zone.rrsets) {
      zone.rrsets = filterRRSets(zonePerm, zone.rrsets);
    }

    logProxy(request, 200, { environment, zone: zone_id, startTime });
    return NextResponse.json(zone);
  } catch (e) {
    logProxy(request, 502, { environment, zone: zone_id, startTime, error: (e as Error).message });
    return NextResponse.json(
      { error: `Failed to connect to PowerDNS: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}

// PATCH /api/v1/servers/[server_id]/zones/[zone_id] — update records
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ server_id: string; zone_id: string }> }
) {
  const startTime = Date.now();
  const auth = authenticateProxyRequest(request);
  if (isAuthError(auth)) {
    logProxy(request, 401, { startTime, error: 'Authentication failed' });
    return auth;
  }

  const { environment, connection } = auth;
  const { zone_id } = await params;

  const zonePerm = isZoneAllowed(environment.id, zone_id);
  if (!zonePerm) {
    logProxy(request, 403, { environment, zone: zone_id, startTime, error: 'Zone not allowed' });
    return NextResponse.json({ error: 'Zone not allowed' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    logProxy(request, 400, { environment, zone: zone_id, startTime, error: 'Invalid JSON' });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rrsets = body.rrsets || [];
  const validation = validatePatchPayload(zonePerm, rrsets);

  if (!validation.allowed) {
    logProxy(request, 403, { environment, zone: zone_id, startTime, error: `Denied records: ${validation.denied.join(', ')}` });
    return NextResponse.json(
      { error: 'Some records are not allowed', denied: validation.denied },
      { status: 403 }
    );
  }

  try {
    const response = await fetch(
      `${connection.url}/api/v1/servers/localhost/zones/${zone_id}`,
      {
        method: 'PATCH',
        headers: { 'X-API-Key': connection.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    const status = response.status;
    logProxy(request, status, { environment, zone: zone_id, startTime });

    if (status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.text();
    return new NextResponse(data, {
      status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (e) {
    logProxy(request, 502, { environment, zone: zone_id, startTime, error: (e as Error).message });
    return NextResponse.json(
      { error: `Failed to connect to PowerDNS: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}

// PUT /api/v1/servers/[server_id]/zones/[zone_id] — not allowed via proxy
export async function PUT(request: NextRequest) {
  logProxy(request, 403, { error: 'Zone metadata update not allowed' });
  return NextResponse.json(
    { error: 'Zone metadata update is not allowed through the proxy' },
    { status: 403 }
  );
}

// DELETE /api/v1/servers/[server_id]/zones/[zone_id] — not allowed via proxy
export async function DELETE(request: NextRequest) {
  logProxy(request, 403, { error: 'Zone deletion not allowed' });
  return NextResponse.json(
    { error: 'Zone deletion is not allowed through the proxy' },
    { status: 403 }
  );
}
