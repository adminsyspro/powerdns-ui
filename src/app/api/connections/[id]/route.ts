import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { encrypt } from '@/lib/crypto';
import { requireAdmin, authzErrorResponse, type AuthContext } from '@/lib/auth/authz';
import { logActivity, clientIp } from '@/lib/activity/log';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx: AuthContext;
  try {
    ctx = requireAdmin(request);
  } catch (e) {
    return authzErrorResponse(e);
  }
  const { id } = await params;
  const body = await request.json();
  const { name, url, apiKey, version, isDefault } = body;

  const db = getDb();

  const existing = db.prepare('SELECT id FROM server_connections WHERE id = ?').get(id);
  if (!existing) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  // If this connection is set as default, clear existing defaults
  if (isDefault) {
    db.prepare('UPDATE server_connections SET is_default = 0').run();
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (url !== undefined) { fields.push('url = ?'); values.push(url); }
  if (apiKey !== undefined) { fields.push('api_key = ?'); values.push(encrypt(apiKey)); }
  if (version !== undefined) { fields.push('version = ?'); values.push(version); }
  if (isDefault !== undefined) { fields.push('is_default = ?'); values.push(isDefault ? 1 : 0); }
  fields.push('updated_at = unixepoch()');

  if (fields.length > 1) {
    db.prepare(`UPDATE server_connections SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }

  // Return updated connection
  const row = db.prepare('SELECT * FROM server_connections WHERE id = ?').get(id) as {
    id: string; name: string; url: string; api_key: string;
    version: string | null; is_default: number; last_connected: number | null;
  };

  if (fields.length > 1) {
    logActivity({
      actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
      action: 'update', resourceType: 'connection',
      resourceId: id, resourceName: row.name,
      details: row.url,
    });
  }

  return NextResponse.json({
    id: row.id,
    name: row.name,
    url: row.url,
    version: row.version ?? undefined,
    isDefault: row.is_default === 1,
    lastConnected: row.last_connected ? new Date(row.last_connected * 1000) : undefined,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx: AuthContext;
  try {
    ctx = requireAdmin(request);
  } catch (e) {
    return authzErrorResponse(e);
  }
  const { id } = await params;
  const db = getDb();

  const existing = db.prepare('SELECT name FROM server_connections WHERE id = ?').get(id) as { name: string } | undefined;

  const result = db.prepare('DELETE FROM server_connections WHERE id = ?').run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  logActivity({
    actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(request),
    action: 'delete', resourceType: 'connection',
    resourceId: id, resourceName: existing?.name ?? id,
    details: null,
  });

  return NextResponse.json({ success: true });
}
