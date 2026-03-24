import { NextRequest, NextResponse } from 'next/server';
import { getHistoryEntry } from '@/lib/cache/history';

// GET /api/zones/history/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entry = getHistoryEntry(id);
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
