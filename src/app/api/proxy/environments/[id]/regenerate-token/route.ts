import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { generateProxyToken, hashToken } from '@/lib/proxy/token';

// POST /api/proxy/environments/[id]/regenerate-token
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM proxy_environments WHERE id = ?').get(id);

  if (!existing) {
    return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
  }

  const rawToken = generateProxyToken();
  const tokenHash = hashToken(rawToken);

  db.prepare(
    'UPDATE proxy_environments SET token_sha512 = ?, updated_at = unixepoch() WHERE id = ?'
  ).run(tokenHash, id);

  return NextResponse.json({
    token: rawToken, // Only returned once
    tokenSha512: tokenHash,
  });
}
