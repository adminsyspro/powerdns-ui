import { NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { encrypt, decrypt } from '@/lib/crypto';

export async function GET() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM server_connections ORDER BY created_at ASC').all() as Array<{
    id: string;
    name: string;
    url: string;
    api_key: string;
    version: string | null;
    is_default: number;
    last_connected: number | null;
    created_at: number;
    updated_at: number;
  }>;

  const connections = rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    apiKey: decrypt(row.api_key),
    version: row.version ?? undefined,
    isDefault: row.is_default === 1,
    lastConnected: row.last_connected ? new Date(row.last_connected * 1000) : undefined,
  }));

  return NextResponse.json(connections);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, url, apiKey, version, isDefault } = body;

  if (!name || !url || !apiKey) {
    return NextResponse.json({ error: 'name, url, and apiKey are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const encryptedApiKey = encrypt(apiKey);

  // If this connection is set as default, clear existing defaults
  if (isDefault) {
    db.prepare('UPDATE server_connections SET is_default = 0').run();
  }

  db.prepare(
    `INSERT INTO server_connections (id, name, url, api_key, version, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, url, encryptedApiKey, version ?? null, isDefault ? 1 : 0);

  return NextResponse.json({
    id,
    name,
    url,
    apiKey,
    version: version ?? undefined,
    isDefault: !!isDefault,
  }, { status: 201 });
}
