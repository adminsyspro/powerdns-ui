import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { decrypt } from '@/lib/crypto';

/**
 * Resolves a stored PowerDNS connection (url + decrypted API key) entirely
 * server-side. The client only tells us *which* connection to use via the
 * `x-pdns-connection-id` header — it never sees or supplies the API key/url.
 * When the id is missing/unknown we fall back to the default connection
 * (is_default, else oldest). Returns null when no connections are stored.
 */
function resolveStoredConnection(connectionId: string | null): { url: string; apiKey: string } | null {
  const db = getDb();
  let row: { url: string; api_key: string } | undefined;
  if (connectionId) {
    row = db
      .prepare('SELECT url, api_key FROM server_connections WHERE id = ?')
      .get(connectionId) as { url: string; api_key: string } | undefined;
  }
  if (!row) {
    row = db
      .prepare('SELECT url, api_key FROM server_connections ORDER BY is_default DESC, created_at ASC LIMIT 1')
      .get() as { url: string; api_key: string } | undefined;
  }
  if (!row) return null;
  return { url: row.url, apiKey: decrypt(row.api_key) };
}

/**
 * Resolves the PowerDNS connection info for a request.
 *
 * SECURITY: the API key and target url are resolved on the server from the
 * stored connection identified by `x-pdns-connection-id`. We deliberately do
 * NOT trust a client-supplied url or API key — that previously let any
 * authenticated user point the proxy at an arbitrary server (or read the
 * master key) and bypass zone-level RBAC. `x-pdns-server-id` is only the
 * PowerDNS *server name* used in API paths (not a secret), defaulting to
 * "localhost". Env vars are used only when no connection is stored.
 */
export function getConnectionFromRequest(request: NextRequest) {
  const serverId = request.headers.get('x-pdns-server-id') || 'localhost';
  const connectionId = request.headers.get('x-pdns-connection-id');

  const stored = resolveStoredConnection(connectionId);
  if (stored) {
    return { url: stored.url.replace(/\/$/, ''), apiKey: stored.apiKey, serverId };
  }

  const url = (process.env.PDNS_API_URL || 'http://localhost:8081').replace(/\/$/, '');
  return { url, apiKey: process.env.PDNS_API_KEY || '', serverId };
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
 * Fetches all zones for a connection directly (no NextRequest needed) so both
 * the /api/zones/sync route and the background worker share one implementation.
 */
export async function fetchZonesFromPdns(
  url: string,
  apiKey: string,
  serverId = 'localhost'
): Promise<unknown[]> {
  const base = url.replace(/\/$/, '');
  const response = await fetch(`${base}/api/v1/servers/${serverId}/zones`, {
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PowerDNS returned ${response.status}: ${text}`);
  }
  return (await response.json()) as unknown[];
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
