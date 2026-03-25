import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import type { ProxyZonePermissionRow, ProxyRecordRuleRow } from '@/types/proxy';

function getZoneWithRules(zonePermId: string) {
  const db = getDb();
  const zone = db.prepare('SELECT * FROM proxy_zone_permissions WHERE id = ?').get(zonePermId) as ProxyZonePermissionRow | undefined;
  if (!zone) return null;

  const rules = db.prepare('SELECT * FROM proxy_record_rules WHERE zone_perm_id = ?').all(zonePermId) as ProxyRecordRuleRow[];

  return {
    id: zone.id,
    environmentId: zone.environment_id,
    zoneName: zone.zone_name,
    acmeEnabled: zone.acme_enabled === 1,
    recordRules: rules.map((r) => ({
      id: r.id,
      ruleType: r.rule_type,
      pattern: r.pattern,
    })),
  };
}

// PUT /api/proxy/environments/[id]/zones/[zonePermId]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; zonePermId: string }> }
) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, zonePermId } = await params;
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM proxy_zone_permissions WHERE id = ? AND environment_id = ?'
  ).get(zonePermId, id) as ProxyZonePermissionRow | undefined;

  if (!existing) {
    return NextResponse.json({ error: 'Zone permission not found' }, { status: 404 });
  }

  const body = await request.json();
  const { zoneName, acmeEnabled, records, regexRecords } = body;

  const transaction = db.transaction(() => {
    // Update zone permission fields
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (zoneName !== undefined) {
      fields.push('zone_name = ?');
      values.push(zoneName);
    }
    if (acmeEnabled !== undefined) {
      fields.push('acme_enabled = ?');
      values.push(acmeEnabled ? 1 : 0);
    }

    if (fields.length > 0) {
      values.push(zonePermId);
      db.prepare(`UPDATE proxy_zone_permissions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Replace record rules if provided
    if (records !== undefined || regexRecords !== undefined) {
      db.prepare('DELETE FROM proxy_record_rules WHERE zone_perm_id = ?').run(zonePermId);

      const insertRule = db.prepare(
        'INSERT INTO proxy_record_rules (id, zone_perm_id, rule_type, pattern) VALUES (?, ?, ?, ?)'
      );

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
    }
  });

  transaction();

  return NextResponse.json(getZoneWithRules(zonePermId));
}

// DELETE /api/proxy/environments/[id]/zones/[zonePermId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; zonePermId: string }> }
) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, zonePermId } = await params;
  const db = getDb();

  const existing = db.prepare(
    'SELECT id FROM proxy_zone_permissions WHERE id = ? AND environment_id = ?'
  ).get(zonePermId, id);

  if (!existing) {
    return NextResponse.json({ error: 'Zone permission not found' }, { status: 404 });
  }

  db.prepare('DELETE FROM proxy_record_rules WHERE zone_perm_id = ?').run(zonePermId);
  db.prepare('DELETE FROM proxy_zone_permissions WHERE id = ?').run(zonePermId);

  return NextResponse.json({ success: true });
}
