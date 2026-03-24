import { NextRequest, NextResponse } from 'next/server';
import { getSession, isOperatorOrAdmin } from '@/lib/auth/session';

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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const response = await pdnsRequest('/servers/localhost/zones');
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching zones:', error);
    return NextResponse.json(
      { error: 'Failed to fetch zones' },
      { status: 500 }
    );
  }
}

// POST /api/zones - Create a new zone
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!isOperatorOrAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    
    const response = await pdnsRequest('/servers/localhost/zones', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating zone:', error);
    return NextResponse.json(
      { error: 'Failed to create zone' },
      { status: 500 }
    );
  }
}
