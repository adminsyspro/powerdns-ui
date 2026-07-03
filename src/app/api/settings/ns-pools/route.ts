import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import { normalizeNameserverPools } from '@/lib/ns-pools';
import { logActivity, actorFromHeaders } from '@/lib/activity/log';

const SETTING_KEY = 'ns_pools';

function readPools() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined;
  if (!row) return [];

  try {
    return normalizeNameserverPools(JSON.parse(row.value));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator' && role !== 'Operator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ pools: readPools() });
}

export async function PUT(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { pools?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const pools = normalizeNameserverPools(body.pools);
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(
    SETTING_KEY,
    JSON.stringify(pools)
  );

  logActivity({
    ...actorFromHeaders(request),
    action: 'update', resourceType: 'setting',
    resourceId: 'ns-pools', resourceName: 'ns-pools',
    details: `${pools.length} pool(s)`,
  });

  return NextResponse.json({ pools });
}
