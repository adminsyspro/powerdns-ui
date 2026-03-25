import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { getZonePermissions } from '@/lib/proxy/access-control';
import type { ProxyEnvironmentRow } from '@/types/proxy';

// GET /api/proxy/environments/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const row = db.prepare('SELECT * FROM proxy_environments WHERE id = ?').get(id) as ProxyEnvironmentRow | undefined;

  if (!row) {
    return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
  }

  const zones = getZonePermissions(id);

  return NextResponse.json({
    id: row.id,
    name: row.name,
    description: row.description,
    tokenSha512: row.token_sha512,
    active: row.active === 1,
    zones,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  });
}

// PUT /api/proxy/environments/[id]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM proxy_environments WHERE id = ?').get(id) as ProxyEnvironmentRow | undefined;

  if (!existing) {
    return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
  }

  const body = await request.json();
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (body.name !== undefined) {
    const dup = db.prepare('SELECT id FROM proxy_environments WHERE name = ? AND id != ?').get(body.name, id);
    if (dup) {
      return NextResponse.json({ error: 'Environment name already exists' }, { status: 409 });
    }
    fields.push('name = ?');
    values.push(body.name);
  }
  if (body.description !== undefined) {
    fields.push('description = ?');
    values.push(body.description);
  }
  if (body.active !== undefined) {
    fields.push('active = ?');
    values.push(body.active ? 1 : 0);
  }

  fields.push('updated_at = unixepoch()');
  values.push(id);

  const insertZone = db.prepare(
    'INSERT INTO proxy_zone_permissions (id, environment_id, zone_name, acme_enabled) VALUES (?, ?, ?, ?)'
  );
  const insertRule = db.prepare(
    'INSERT INTO proxy_record_rules (id, zone_perm_id, rule_type, pattern) VALUES (?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    db.prepare(`UPDATE proxy_environments SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Replace zones if provided
    if (body.zones !== undefined && Array.isArray(body.zones)) {
      // Delete existing zones and rules
      db.prepare('DELETE FROM proxy_record_rules WHERE zone_perm_id IN (SELECT id FROM proxy_zone_permissions WHERE environment_id = ?)').run(id);
      db.prepare('DELETE FROM proxy_zone_permissions WHERE environment_id = ?').run(id);

      for (const zone of body.zones) {
        if (!zone.zoneName) continue;
        const zonePermId = crypto.randomUUID();
        insertZone.run(zonePermId, id, zone.zoneName, zone.acmeEnabled ? 1 : 0);

        if (zone.records && Array.isArray(zone.records)) {
          for (const record of zone.records) {
            if (record.trim()) insertRule.run(crypto.randomUUID(), zonePermId, 'exact', record);
          }
        }
        if (zone.regexRecords && Array.isArray(zone.regexRecords)) {
          for (const pattern of zone.regexRecords) {
            if (pattern.trim()) insertRule.run(crypto.randomUUID(), zonePermId, 'regex', pattern);
          }
        }
      }
    }
  });

  transaction();

  const updated = db.prepare('SELECT * FROM proxy_environments WHERE id = ?').get(id) as ProxyEnvironmentRow;
  const zones = getZonePermissions(id);

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    description: updated.description,
    tokenSha512: updated.token_sha512,
    active: updated.active === 1,
    zones,
    createdAt: new Date(updated.created_at * 1000).toISOString(),
    updatedAt: new Date(updated.updated_at * 1000).toISOString(),
  });
}

// DELETE /api/proxy/environments/[id]
export async function DELETE(
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

  db.prepare('DELETE FROM proxy_record_rules WHERE zone_perm_id IN (SELECT id FROM proxy_zone_permissions WHERE environment_id = ?)').run(id);
  db.prepare('DELETE FROM proxy_zone_permissions WHERE environment_id = ?').run(id);
  db.prepare('DELETE FROM proxy_environments WHERE id = ?').run(id);

  return NextResponse.json({ success: true });
}
