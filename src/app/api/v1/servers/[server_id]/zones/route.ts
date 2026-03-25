import { NextRequest, NextResponse } from 'next/server';
import { authenticateProxyRequest, isAuthError, logProxy } from '@/lib/proxy/auth';
import { filterZones } from '@/lib/proxy/access-control';

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
    const filtered = filterZones(environment.id, zones);

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

// POST /api/v1/servers/[server_id]/zones — zone creation not allowed via proxy
export async function POST(request: NextRequest) {
  logProxy(request, 403, { error: 'Zone creation not allowed' });
  return NextResponse.json(
    { error: 'Zone creation is not allowed through the proxy' },
    { status: 403 }
  );
}
