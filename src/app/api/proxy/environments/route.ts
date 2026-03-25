import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { generateProxyToken, hashToken } from '@/lib/proxy/token';
import type { ProxyEnvironmentRow } from '@/types/proxy';

function toResponse(row: ProxyEnvironmentRow, zoneCount?: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tokenSha512: row.token_sha512,
    active: row.active === 1,
    zoneCount: zoneCount ?? 0,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

// GET /api/proxy/environments
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const rows = db.prepare(
    `SELECT e.*, COUNT(z.id) as zone_count
     FROM proxy_environments e
     LEFT JOIN proxy_zone_permissions z ON z.environment_id = e.id
     GROUP BY e.id
     ORDER BY e.created_at ASC`
  ).all() as (ProxyEnvironmentRow & { zone_count: number })[];

  return NextResponse.json(rows.map((r) => toResponse(r, r.zone_count)));
}

// POST /api/proxy/environments
export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { name, description, zones } = body as {
    name: string;
    description?: string;
    zones?: Array<{
      zoneName: string;
      acmeEnabled?: boolean;
      records?: string[];
      regexRecords?: string[];
    }>;
  };

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const db = getDb();

  // Check name uniqueness
  const existing = db.prepare('SELECT id FROM proxy_environments WHERE name = ?').get(name);
  if (existing) {
    return NextResponse.json({ error: 'Environment name already exists' }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const rawToken = generateProxyToken();
  const tokenHash = hashToken(rawToken);

  const insertEnv = db.prepare(
    `INSERT INTO proxy_environments (id, name, description, token_sha512)
     VALUES (?, ?, ?, ?)`
  );
  const insertZone = db.prepare(
    `INSERT INTO proxy_zone_permissions (id, environment_id, zone_name, acme_enabled)
     VALUES (?, ?, ?, ?)`
  );
  const insertRule = db.prepare(
    `INSERT INTO proxy_record_rules (id, zone_perm_id, rule_type, pattern)
     VALUES (?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    insertEnv.run(id, name, description || '', tokenHash);

    if (zones && Array.isArray(zones)) {
      for (const zone of zones) {
        if (!zone.zoneName) continue;
        const zonePermId = crypto.randomUUID();
        insertZone.run(zonePermId, id, zone.zoneName, zone.acmeEnabled ? 1 : 0);

        if (zone.records) {
          for (const record of zone.records) {
            if (record.trim()) insertRule.run(crypto.randomUUID(), zonePermId, 'exact', record);
          }
        }
        if (zone.regexRecords) {
          for (const pattern of zone.regexRecords) {
            if (pattern.trim()) insertRule.run(crypto.randomUUID(), zonePermId, 'regex', pattern);
          }
        }
      }
    }
  });

  transaction();

  const row = db.prepare('SELECT * FROM proxy_environments WHERE id = ?').get(id) as ProxyEnvironmentRow;

  return NextResponse.json({
    ...toResponse(row),
    token: rawToken, // Only returned once at creation
  }, { status: 201 });
}
