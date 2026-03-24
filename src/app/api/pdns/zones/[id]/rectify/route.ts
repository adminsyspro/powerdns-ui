import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/pdns/zones/[id]/rectify - Rectify zone
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}/rectify`, {
      method: 'PUT',
    });
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
