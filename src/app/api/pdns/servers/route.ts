import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

// GET /api/pdns/servers - Get server info
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}`);
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
