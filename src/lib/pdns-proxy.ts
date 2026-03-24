import { NextRequest, NextResponse } from 'next/server';

/**
 * Extracts PowerDNS connection info from the request headers,
 * falling back to environment variables.
 */
export function getConnectionFromRequest(request: NextRequest) {
  const url = request.headers.get('x-pdns-url') || process.env.PDNS_API_URL || 'http://localhost:8081';
  const apiKey = request.headers.get('x-pdns-api-key') || process.env.PDNS_API_KEY || '';
  const serverId = request.headers.get('x-pdns-server-id') || 'localhost';
  return { url: url.replace(/\/$/, ''), apiKey, serverId };
}

/**
 * Proxies a request to the PowerDNS API.
 */
export async function pdnsProxy(
  request: NextRequest,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const conn = getConnectionFromRequest(request);
  const url = `${conn.url}/api/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'X-API-Key': conn.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return response;
}

/**
 * Helper to forward a PowerDNS response as a NextResponse.
 */
export async function forwardPdnsResponse(response: Response): Promise<NextResponse> {
  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const contentType = response.headers.get('content-type') || '';

  // If the response is plain text (e.g. zone export), return as text
  if (contentType.includes('text/plain')) {
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
