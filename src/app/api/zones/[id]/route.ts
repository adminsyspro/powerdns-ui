import { NextRequest, NextResponse } from 'next/server';
import { getSession, isOperatorOrAdmin, isAdmin } from '@/lib/auth/session';

const PDNS_API_URL = process.env.PDNS_API_URL || 'http://localhost:8081';
const PDNS_API_KEY = process.env.PDNS_API_KEY || '';

async function pdnsRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${PDNS_API_URL}/api/v1${endpoint}`;
  
  return fetch(url, {
    ...options,
    headers: {
      'X-API-Key': PDNS_API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// GET /api/zones/[id] - Get zone details with records and comments
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: zoneId } = await params;

  try {
    // Fetch zone with RRsets (includes comments)
    const response = await pdnsRequest(`/servers/localhost/zones/${zoneId}?rrsets=true`);
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching zone:', error);
    return NextResponse.json(
      { error: 'Failed to fetch zone' },
      { status: 500 }
    );
  }
}

// PATCH /api/zones/[id] - Update zone records (with comments support)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!isOperatorOrAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: zoneId } = await params;

  try {
    const body = await request.json();
    
    // Body should contain { rrsets: [...] }
    // Each RRset can include comments:
    // {
    //   name: "example.com.",
    //   type: "A",
    //   ttl: 3600,
    //   changetype: "REPLACE",
    //   records: [{ content: "192.168.1.1", disabled: false }],
    //   comments: [{ content: "Production server", account: "admin", modified_at: 1234567890 }]
    // }

    const response = await pdnsRequest(`/servers/localhost/zones/${zoneId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error updating zone:', error);
    return NextResponse.json(
      { error: 'Failed to update zone' },
      { status: 500 }
    );
  }
}

// PUT /api/zones/[id] - Update zone properties
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!isOperatorOrAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: zoneId } = await params;

  try {
    const body = await request.json();
    
    const response = await pdnsRequest(`/servers/localhost/zones/${zoneId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error updating zone:', error);
    return NextResponse.json(
      { error: 'Failed to update zone' },
      { status: 500 }
    );
  }
}

// DELETE /api/zones/[id] - Delete zone
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 });
  }

  const { id: zoneId } = await params;

  try {
    const response = await pdnsRequest(`/servers/localhost/zones/${zoneId}`, {
      method: 'DELETE',
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error deleting zone:', error);
    return NextResponse.json(
      { error: 'Failed to delete zone' },
      { status: 500 }
    );
  }
}
