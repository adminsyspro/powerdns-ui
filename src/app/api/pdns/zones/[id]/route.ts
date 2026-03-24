import { NextRequest } from 'next/server';
import { pdnsProxy, forwardPdnsResponse, getConnectionFromRequest } from '@/lib/pdns-proxy';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/pdns/zones/[id] - Get zone details with records
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}?rrsets=true`);
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}

// PATCH /api/pdns/zones/[id] - Update zone records (RRsets)
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const body = await request.json();
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}

// PUT /api/pdns/zones/[id] - Update zone properties
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const body = await request.json();
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}

// DELETE /api/pdns/zones/[id] - Delete zone
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const conn = getConnectionFromRequest(request);
    const response = await pdnsProxy(request, `/servers/${conn.serverId}/zones/${id}`, {
      method: 'DELETE',
    });
    return forwardPdnsResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 502 });
  }
}
