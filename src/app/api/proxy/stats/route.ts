import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';

// GET /api/proxy/stats
export async function GET(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  // Total requests by period
  const today = db.prepare('SELECT COUNT(*) as count FROM proxy_logs WHERE timestamp >= ?').get(now - day) as { count: number };
  const week = db.prepare('SELECT COUNT(*) as count FROM proxy_logs WHERE timestamp >= ?').get(now - 7 * day) as { count: number };
  const month = db.prepare('SELECT COUNT(*) as count FROM proxy_logs WHERE timestamp >= ?').get(now - 30 * day) as { count: number };

  // Errors (4xx + 5xx)
  const errorsToday = db.prepare('SELECT COUNT(*) as count FROM proxy_logs WHERE timestamp >= ? AND status >= 400').get(now - day) as { count: number };
  const errorsWeek = db.prepare('SELECT COUNT(*) as count FROM proxy_logs WHERE timestamp >= ? AND status >= 400').get(now - 7 * day) as { count: number };

  // Top IPs (last 7 days)
  const topIps = db.prepare(
    `SELECT ip, COUNT(*) as count FROM proxy_logs
     WHERE timestamp >= ? AND ip != ''
     GROUP BY ip ORDER BY count DESC LIMIT 10`
  ).all(now - 7 * day) as Array<{ ip: string; count: number }>;

  // Top zones (last 7 days)
  const topZones = db.prepare(
    `SELECT zone, COUNT(*) as count FROM proxy_logs
     WHERE timestamp >= ? AND zone IS NOT NULL AND zone != ''
     GROUP BY zone ORDER BY count DESC LIMIT 10`
  ).all(now - 7 * day) as Array<{ zone: string; count: number }>;

  // Top API accesses (last 7 days)
  const topAccesses = db.prepare(
    `SELECT environment_name as name, COUNT(*) as count FROM proxy_logs
     WHERE timestamp >= ? AND environment_name IS NOT NULL
     GROUP BY environment_name ORDER BY count DESC LIMIT 10`
  ).all(now - 7 * day) as Array<{ name: string; count: number }>;

  // Requests per day (last 7 days)
  const dailyRequests = db.prepare(
    `SELECT (timestamp / 86400) as day_ts, COUNT(*) as count,
            SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors
     FROM proxy_logs
     WHERE timestamp >= ?
     GROUP BY day_ts ORDER BY day_ts ASC`
  ).all(now - 7 * day) as Array<{ day_ts: number; count: number; errors: number }>;

  const daily = dailyRequests.map((r) => ({
    date: new Date(r.day_ts * 86400 * 1000).toISOString().split('T')[0],
    requests: r.count,
    errors: r.errors,
  }));

  // Status code breakdown (last 7 days)
  const statusBreakdown = db.prepare(
    `SELECT
       SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as success,
       SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as clientError,
       SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as serverError
     FROM proxy_logs WHERE timestamp >= ?`
  ).get(now - 7 * day) as { success: number; clientError: number; serverError: number };

  return NextResponse.json({
    requests: { today: today.count, week: week.count, month: month.count },
    errors: { today: errorsToday.count, week: errorsWeek.count },
    statusBreakdown: {
      success: statusBreakdown.success || 0,
      clientError: statusBreakdown.clientError || 0,
      serverError: statusBreakdown.serverError || 0,
    },
    topIps,
    topZones,
    topAccesses,
    daily,
  });
}
