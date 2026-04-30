import { NextRequest, NextResponse } from 'next/server';
import { parseBind } from '@/lib/bind/parser';

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator' && role !== 'Operator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { content?: unknown; origin?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
  }
  if (body.origin !== undefined && typeof body.origin !== 'string') {
    return NextResponse.json({ error: 'origin must be a string when provided' }, { status: 400 });
  }
  const contentBytes = new TextEncoder().encode(body.content).byteLength;
  if (contentBytes > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes` },
      { status: 413 },
    );
  }

  try {
    const preview = parseBind(body.content, body.origin || undefined);
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'parse error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
