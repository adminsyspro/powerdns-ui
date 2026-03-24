import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/pdns/zones/[id]/export - Export zone in AXFR format
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}/export`);
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
