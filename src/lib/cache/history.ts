import { getDb } from './db';
import type { ChangesetSubmission } from '@/types/powerdns';

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

export function saveChangeset(serverUrl: string, submission: ChangesetSubmission): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO change_history (id, server_url, zone_id, zone_name, changes_json, reason, user, submitted_at, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    submission.id,
    normalizeUrl(serverUrl),
    submission.zoneId,
    submission.zoneName,
    JSON.stringify(submission.changes),
    submission.reason,
    submission.user,
    submission.submittedAt,
    submission.status,
    submission.errorMessage || null
  );
}

export interface HistoryQuery {
  zoneId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedHistory {
  items: ChangesetSubmission[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function getHistory(serverUrl: string, params: HistoryQuery = {}): PaginatedHistory {
  const db = getDb();
  const key = normalizeUrl(serverUrl);
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

  const conditions: string[] = ['server_url = ?'];
  const values: (string | number)[] = [key];

  if (params.zoneId) {
    conditions.push('zone_id = ?');
    values.push(params.zoneId);
  }

  const where = conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM change_history WHERE ${where}`).get(...values) as { total: number };
  const total = countRow.total;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(`
    SELECT id, zone_id, zone_name, changes_json, reason, user, submitted_at, status, error_message
    FROM change_history WHERE ${where}
    ORDER BY submitted_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset) as Array<{
    id: string;
    zone_id: string;
    zone_name: string;
    changes_json: string;
    reason: string;
    user: string;
    submitted_at: number;
    status: string;
    error_message: string | null;
  }>;

  const items: ChangesetSubmission[] = rows.map((row) => ({
    id: row.id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    changes: JSON.parse(row.changes_json),
    reason: row.reason,
    user: row.user,
    submittedAt: row.submitted_at,
    status: row.status as 'success' | 'error',
    errorMessage: row.error_message || undefined,
  }));

  return { items, total, page, pageSize, totalPages };
}

export function getHistoryEntry(id: string): ChangesetSubmission | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, zone_id, zone_name, changes_json, reason, user, submitted_at, status, error_message
    FROM change_history WHERE id = ?
  `).get(id) as {
    id: string; zone_id: string; zone_name: string; changes_json: string;
    reason: string; user: string; submitted_at: number; status: string; error_message: string | null;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    changes: JSON.parse(row.changes_json),
    reason: row.reason,
    user: row.user,
    submittedAt: row.submitted_at,
    status: row.status as 'success' | 'error',
    errorMessage: row.error_message || undefined,
  };
}

/**
 * Find the last change that affected a specific RRSet (name::type).
 * Scans change_history rows in reverse chronological order.
 */
export function getLastChangeForRRSet(
  serverUrl: string,
  zoneId: string,
  rrsetKey: string
): { change: import('@/types/powerdns').PendingChange; reason: string; user: string; submittedAt: number } | null {
  const db = getDb();
  const key = normalizeUrl(serverUrl);

  // Get recent history entries for this zone (limit search to last 50 for perf)
  const rows = db.prepare(`
    SELECT changes_json, reason, user, submitted_at
    FROM change_history
    WHERE server_url = ? AND zone_id = ? AND status = 'success'
    ORDER BY submitted_at DESC
    LIMIT 50
  `).all(key, zoneId) as Array<{
    changes_json: string;
    reason: string;
    user: string;
    submitted_at: number;
  }>;

  for (const row of rows) {
    const changes = JSON.parse(row.changes_json) as import('@/types/powerdns').PendingChange[];
    const match = changes.find((c) => c.rrsetKey === rrsetKey);
    if (match) {
      return {
        change: match,
        reason: row.reason,
        user: row.user,
        submittedAt: row.submitted_at,
      };
    }
  }

  return null;
}
