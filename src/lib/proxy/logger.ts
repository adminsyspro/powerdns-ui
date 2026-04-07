import { getDb } from '@/lib/cache/db';

const RETENTION_DAYS = 30;
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 3600_000; // 1 hour

export interface ProxyLogEntry {
  environmentId?: string | null;
  environmentName?: string | null;
  method: string;
  path: string;
  zone?: string | null;
  status: number;
  ip?: string;
  userAgent?: string;
  durationMs?: number;
  error?: string | null;
  requestBody?: string | null;
}

/**
 * Log a proxy request to the database.
 * Automatically cleans old logs (> 30 days) once per hour.
 */
export function logProxyRequest(entry: ProxyLogEntry): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO proxy_logs (environment_id, environment_name, method, path, zone, status, ip, user_agent, duration_ms, error, request_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.environmentId || null,
      entry.environmentName || null,
      entry.method,
      entry.path,
      entry.zone || null,
      entry.status,
      entry.ip || '',
      entry.userAgent || '',
      entry.durationMs || 0,
      entry.error || null,
      entry.requestBody || null
    );

    // Periodic cleanup
    const now = Date.now();
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      lastCleanup = now;
      cleanOldLogs();
    }
  } catch {
    // Don't let logging failures break the proxy
  }
}

/**
 * Clean up logs older than RETENTION_DAYS.
 */
export function cleanOldLogs(days: number = RETENTION_DAYS): void {
  try {
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    db.prepare('DELETE FROM proxy_logs WHERE timestamp < ?').run(cutoff);
  } catch {
    // Ignore
  }
}
