import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { getZonePermissions } from '@/lib/proxy/access-control';
import type { ProxyZonePermissionRow, ProxyRecordRuleRow } from '@/types/proxy';

// GET /api/proxy/environments/[id]/zones
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
  const env = db.prepare('SELECT id FROM proxy_environments WHERE id = ?').get(id);
  if (!env) {
    return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
  }

  const zones = getZonePermissions(id);
  return NextResponse.json(zones);
}

// POST /api/proxy/environments/[id]/zones
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
  const env = db.prepare('SELECT id FROM proxy_environments WHERE id = ?').get(id);
  if (!env) {
    return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
  }

  const body = await request.json();
  const { zoneName, acmeEnabled, records, regexRecords } = body;

  if (!zoneName) {
    return NextResponse.json({ error: 'zoneName is required' }, { status: 400 });
  }

  // Check uniqueness
  const existing = db.prepare(
    'SELECT id FROM proxy_zone_permissions WHERE environment_id = ? AND zone_name = ?'
  ).get(id, zoneName);
  if (existing) {
    return NextResponse.json({ error: 'Zone already exists in this environment' }, { status: 409 });
  }

  const zonePermId = crypto.randomUUID();

  const insertZone = db.prepare(
    `INSERT INTO proxy_zone_permissions (id, environment_id, zone_name, acme_enabled)
     VALUES (?, ?, ?, ?)`
  );

  const insertRule = db.prepare(
    `INSERT INTO proxy_record_rules (id, zone_perm_id, rule_type, pattern)
     VALUES (?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    insertZone.run(zonePermId, id, zoneName, acmeEnabled ? 1 : 0);

    if (records && Array.isArray(records)) {
      for (const record of records) {
        insertRule.run(crypto.randomUUID(), zonePermId, 'exact', record);
      }
    }

    if (regexRecords && Array.isArray(regexRecords)) {
      for (const pattern of regexRecords) {
        insertRule.run(crypto.randomUUID(), zonePermId, 'regex', pattern);
      }
    }
  });

  transaction();

  // Return the created zone permission with rules
  const zones = getZonePermissions(id);
  const created = zones.find((z) => z.id === zonePermId);

  return NextResponse.json(created, { status: 201 });
}
