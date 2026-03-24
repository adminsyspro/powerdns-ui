import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

// PUT /api/pdns/cache?domain=... - Flush cache for a domain
export async function PUT(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get('domain') || '';

    const response = await pdnsProxy(
      request,
      `/servers/${conn.serverId}/cache/flush?domain=${encodeURIComponent(domain)}`,
      { method: 'PUT' }
    );
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
