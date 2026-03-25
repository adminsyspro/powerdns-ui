import { NextRequest, NextResponse } from 'next/server';
import { authenticateProxyRequest, isAuthError, logProxy } from '@/lib/proxy/auth';
import { isZoneAllowed } from '@/lib/proxy/access-control';

// PUT /api/v1/servers/[server_id]/zones/[zone_id]/notify
export async function PUT(
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
      `${connection.url}/api/v1/servers/localhost/zones/${zone_id}/notify`,
      {
        method: 'PUT',
        headers: { 'X-API-Key': connection.apiKey },
      }
    );

    logProxy(request, response.status, { environment, zone: zone_id, startTime });

    if (response.status === 200) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    return new NextResponse(null, { status: response.status });
  } catch (e) {
    logProxy(request, 502, { environment, zone: zone_id, startTime, error: (e as Error).message });
    return NextResponse.json(
      { error: `Failed to connect to PowerDNS: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
