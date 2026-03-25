import { NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { decrypt } from '@/lib/crypto';

// GET /api/health/pdns — no auth required
export async function GET() {
  const db = getDb();

  // Try the default server connection
  const conn = db.prepare(
    'SELECT url, api_key FROM server_connections ORDER BY is_default DESC, created_at ASC LIMIT 1'
  ).get() as { url: string; api_key: string } | undefined;

  if (!conn) {
    return NextResponse.json({ status: 'error', message: 'No server connection configured' }, { status: 503 });
  }

  try {
    const url = conn.url.replace(/\/$/, '');
    const response = await fetch(`${url}/api/v1/servers/localhost`, {
      headers: { 'X-API-Key': decrypt(conn.api_key) },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return NextResponse.json({ status: 'ok' });
    }

    return NextResponse.json(
      { status: 'error', message: `PowerDNS returned ${response.status}` },
      { status: 503 }
    );
  } catch (e) {
    return NextResponse.json(
      { status: 'error', message: (e as Error).message },
      { status: 503 }
    );
  }
}
