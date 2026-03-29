import { NextRequest, NextResponse } from 'next/server';
import { getConnectionFromRequest } from '@/lib/pdns-proxy';
import { saveChangeset, getHistory } from '@/lib/cache/history';

// POST /api/zones/history - Save a changeset to history
export async function POST(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const body = await request.json();
    saveChangeset(conn.url, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/zones/history?zoneId=&page=&pageSize=
export async function GET(request: NextRequest) {
  try {
    const conn = getConnectionFromRequest(request);
    const { searchParams } = new URL(request.url);
    const result = getHistory(conn.url, {
      zoneId: searchParams.get('zoneId') || undefined,
      page: Number.parseInt(searchParams.get('page') || '1'),
      pageSize: Number.parseInt(searchParams.get('pageSize') || '20'),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
