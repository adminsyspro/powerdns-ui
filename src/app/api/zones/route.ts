import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromHeaders, requireAuth, requireCreateInGroup, canSeeAllZones, authzErrorResponse } from '@/lib/auth/authz';

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

// GET /api/zones - List all zones
export async function GET(request: NextRequest) {
  try {
    const ctx = requireAuth(getAuthContextFromHeaders(request));

    const response = await pdnsRequest('/servers/localhost/zones');
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const visible = canSeeAllZones(ctx.role)
      ? data
      : (data as Array<{ account?: string }>).filter((z) => z.account && ctx.groupSlugs.includes(z.account));

    return NextResponse.json(visible);
  } catch (e) {
    return authzErrorResponse(e);
  }
}

// POST /api/zones - Create a new zone
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const ctx = getAuthContextFromHeaders(request);
    requireCreateInGroup(ctx, String(body.account ?? ''));

    const response = await pdnsRequest('/servers/localhost/zones', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return authzErrorResponse(e);
  }
}
