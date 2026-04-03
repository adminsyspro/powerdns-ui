import { NextRequest, NextResponse } from 'next/server';
import { authenticateProxyRequest, isAuthError, logProxy } from '@/lib/proxy/auth';

// GET /api/v1/servers/[server_id] — proxy server info (needed by lego/certbot for API version check)
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const auth = authenticateProxyRequest(request);
  if (isAuthError(auth)) {
    logProxy(request, 401, { startTime, error: 'Authentication failed' });
    return auth;
  }

  const { environment, connection } = auth;

  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    // Extract server_id from /api/v1/servers/[server_id]
    const serverId = pathParts[4] || 'localhost';

    const response = await fetch(
      `${connection.url}/api/v1/servers/${serverId}`,
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

    const data = await response.json();
    logProxy(request, 200, { environment, startTime });
    return NextResponse.json(data);
  } catch (e) {
    logProxy(request, 502, { environment, startTime, error: (e as Error).message });
    return NextResponse.json(
      { error: `Failed to connect to PowerDNS: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
