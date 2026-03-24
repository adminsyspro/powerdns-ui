import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

// GET /api/pdns/search?q=...&max=...&object_type=... - Search zones/records/comments
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const max = searchParams.get('max') || '100';
    const objectType = searchParams.get('object_type');

    const params = new URLSearchParams({ q, max });
    if (objectType && objectType !== 'all') {
      params.set('object_type', objectType);
    }

    const response = await pdnsProxy(
      request,
      `/servers/${conn.serverId}/search-data?${params}`
    );
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
