import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';

interface LogRow {
  id: number;
  timestamp: number;
  environment_id: string | null;
  environment_name: string | null;
  method: string;
  path: string;
  zone: string | null;
  status: number;
  ip: string;
  user_agent: string;
  duration_ms: number;
  error: string | null;
}

// GET /api/proxy/logs?page=1&pageSize=50&env=&status=&since=
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '50')));
  const envFilter = searchParams.get('env') || '';
  const statusFilter = searchParams.get('status') || '';
  const sinceId = Number.parseInt(searchParams.get('sinceId') || '0');

  const db = getDb();

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (sinceId > 0) {
    conditions.push('id > ?');
    values.push(sinceId);
  }

  if (envFilter) {
    conditions.push('environment_name = ?');
    values.push(envFilter);
  }

  if (statusFilter === 'error') {
    conditions.push('status >= 400');
  } else if (statusFilter === 'success') {
    conditions.push('status < 400');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM proxy_logs ${where}`).get(...values) as { count: number };
  const total = countRow.count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(
    `SELECT * FROM proxy_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...values, pageSize, offset) as LogRow[];

  const items = rows.map((row) => ({
    id: row.id,
    timestamp: new Date(row.timestamp * 1000).toISOString(),
    environmentId: row.environment_id,
    environmentName: row.environment_name,
    method: row.method,
    path: row.path,
    zone: row.zone,
    status: row.status,
    ip: row.ip,
    userAgent: row.user_agent,
    durationMs: row.duration_ms,
    error: row.error,
  }));

  return NextResponse.json({ items, total, page, pageSize, totalPages });
}
