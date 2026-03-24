import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

// GET /api/pdns/zones - List all zones
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`);
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}

// POST /api/pdns/zones - Create a new zone
export async function POST(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const body = await request.json();
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
