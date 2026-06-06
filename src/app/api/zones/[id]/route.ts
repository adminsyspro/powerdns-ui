import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthContextFromHeaders, requireAuth, requireZoneAccess, requireRole,
  isZoneLevelPatch, AuthzError, authzErrorResponse,
} from '@/lib/auth/authz';
import { getZoneAccountByIdAndServer } from '@/lib/cache/zones';

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

// SECURITY: authorize against the SAME PowerDNS server the mutation targets. The
// handlers below mutate via the module-level helper that uses process.env.PDNS_API_URL —
// NOT getConnectionFromRequest() (which honours a client-supplied x-pdns-url header and
// could point the authz lookup at a different cached server where the caller has a
// same-id zone in one of their groups, while the write still lands on PDNS_API_URL).
function zoneAccount(zoneId: string): string | null {
  return getZoneAccountByIdAndServer(PDNS_API_URL, zoneId);
}

// GET /api/zones/[id] - Get zone details with records and comments
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: zoneId } = await params;

  try {
    // Fetch zone with RRsets (includes comments)
    const response = await pdnsRequest(`/servers/localhost/zones/${zoneId}?rrsets=true`);
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const ctx = requireAuth(getAuthContextFromHeaders(request));
    requireZoneAccess(ctx, { account: (data as { account?: string }).account ?? '' }, 'read');

    return NextResponse.json(data);
  } catch (error) {
    return authzErrorResponse(error);
  }
}

// PATCH /api/zones/[id] - Update zone records (with comments support)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: zoneId } = await params;

  try {
    const body = await request.json();

    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = zoneAccount(zoneId);
    if (account === null && ctx.role !== 'Administrator') {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-records');
    if (ctx.role === 'Customer' && Array.isArray(body.rrsets) && isZoneLevelPatch(body.rrsets, zoneId)) {
      throw new AuthzError(403, 'Customers cannot modify zone-level records (SOA / apex NS / DNSSEC)');
    }

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
    return authzErrorResponse(error);
  }
}

// PUT /api/zones/[id] - Update zone properties
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: zoneId } = await params;

  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));
    const account = zoneAccount(zoneId);
    if (account === null && ctx.role !== 'Administrator') {
      throw new AuthzError(403, 'Zone not found in cache; sync required before scoped access');
    }
    requireZoneAccess(ctx, { account: account ?? '' }, 'write-zone');

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
    return authzErrorResponse(error);
  }
}

// DELETE /api/zones/[id] - Delete zone
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: zoneId } = await params;

  try {
    requireRole(getAuthContextFromHeaders(request), 'Administrator');

    const response = await pdnsRequest(`/servers/localhost/zones/${zoneId}`, {
      method: 'DELETE',
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return authzErrorResponse(error);
  }
}
