import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { decrypt } from '@/lib/crypto';
import { hashToken } from './token';
import { getEnvironmentByTokenHash } from './access-control';
import { logProxyRequest } from './logger';
import type { ProxyEnvironmentRow } from '@/types/proxy';

interface ServerConnection {
  id: string;
  name: string;
  url: string;
  apiKey: string;
}

export interface ProxyAuthResult {
  environment: ProxyEnvironmentRow;
  connection: ServerConnection;
}

/**
 * Get the global proxy server connection.
 * Uses the app_settings key 'proxy_server_id', falling back to the default server connection.
 */
function getProxyServerConnection(): ServerConnection | null {
  const db = getDb();

  // Check for explicit proxy server setting
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'proxy_server_id'").get() as { value: string } | undefined;

  let connRow: { id: string; name: string; url: string; api_key: string } | undefined;

  if (setting?.value) {
    connRow = db.prepare('SELECT id, name, url, api_key FROM server_connections WHERE id = ?').get(setting.value) as typeof connRow;
  }

  // Fallback to default connection
  if (!connRow) {
    connRow = db.prepare('SELECT id, name, url, api_key FROM server_connections ORDER BY is_default DESC, created_at ASC LIMIT 1').get() as typeof connRow;
  }

  if (!connRow) return null;

  return {
    id: connRow.id,
    name: connRow.name,
    url: connRow.url.replace(/\/$/, ''),
    apiKey: decrypt(connRow.api_key),
  };
}

/**
 * Authenticate a proxy request using the X-API-Key header.
 * Returns the environment and the global proxy server connection,
 * or a NextResponse with 401/403 error.
 */
export function authenticateProxyRequest(
  request: NextRequest
): ProxyAuthResult | NextResponse {
  const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing API key. Provide X-API-Key header.' },
      { status: 401 }
    );
  }

  const tokenHash = hashToken(apiKey);
  const environment = getEnvironmentByTokenHash(tokenHash);

  if (!environment) {
    return NextResponse.json(
      { error: 'Invalid API key.' },
      { status: 401 }
    );
  }

  if (!environment.active) {
    return NextResponse.json(
      { error: 'Environment is disabled.' },
      { status: 403 }
    );
  }

  const connection = getProxyServerConnection();
  if (!connection) {
    return NextResponse.json(
      { error: 'No server connection configured for the proxy.' },
      { status: 500 }
    );
  }

  return { environment, connection };
}

/**
 * Helper to check if the auth result is an error response.
 */
export function isAuthError(result: ProxyAuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Extract client info from the request for logging.
 */
export function getClientInfo(request: NextRequest) {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || '',
    userAgent: request.headers.get('user-agent') || '',
    method: request.method,
    path: new URL(request.url).pathname,
  };
}

/**
 * Log a completed proxy request.
 */
export function logProxy(
  request: NextRequest,
  status: number,
  opts?: {
    environment?: ProxyEnvironmentRow;
    zone?: string;
    error?: string;
    startTime?: number;
  }
) {
  const info = getClientInfo(request);
  logProxyRequest({
    environmentId: opts?.environment?.id,
    environmentName: opts?.environment?.name,
    method: info.method,
    path: info.path,
    zone: opts?.zone,
    status,
    ip: info.ip,
    userAgent: info.userAgent,
    durationMs: opts?.startTime ? Date.now() - opts.startTime : 0,
    error: opts?.error,
  });
}
