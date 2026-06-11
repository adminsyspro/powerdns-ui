import { getDb } from './db';
import type { ZoneListItem } from '@/types/powerdns';

// In-memory lock to prevent concurrent syncs for the same server
const syncLocks = new Map<string, boolean>();

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase();
}

// ---- Sync ----

export interface SyncResult {
  zoneCount: number;
  durationMs: number;
  lastSyncAt: number;
}

/**
 * Bulk upsert zones from PowerDNS into the SQLite cache.
 * Uses a transaction for atomicity — fast even for 3000+ zones.
 */
export function syncZonesToCache(serverUrl: string, zones: ZoneListItem[]): SyncResult {
  const key = normalizeUrl(serverUrl);

  if (syncLocks.get(key)) {
    // Return existing sync meta if a sync is already in progress
    const meta = getSyncMeta(serverUrl);
    return meta || { zoneCount: 0, durationMs: 0, lastSyncAt: 0 };
  }

  syncLocks.set(key, true);
  const startTime = Date.now();

  try {
    const db = getDb();
    const deleteStmt = db.prepare('DELETE FROM zones WHERE server_url = ?');
    const insertStmt = db.prepare(`
      INSERT INTO zones (id, server_url, name, url, kind, dnssec, account, serial, edited_serial, notified_serial, last_check)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertMeta = db.prepare(`
      INSERT OR REPLACE INTO sync_meta (server_url, last_sync_at, zone_count, sync_duration_ms)
      VALUES (?, ?, ?, ?)
    `);

    const durationMs = (() => {
      const tx = db.transaction(() => {
        deleteStmt.run(key);
        for (const zone of zones) {
          insertStmt.run(
            zone.id,
            key,
            zone.name,
            zone.url || '',
            zone.kind,
            zone.dnssec ? 1 : 0,
            zone.account || '',
            zone.serial || 0,
            zone.edited_serial || 0,
            zone.notified_serial || 0,
            zone.last_check || 0
          );
        }
      });
      tx();
      return Date.now() - startTime;
    })();

    const lastSyncAt = Date.now();
    upsertMeta.run(key, lastSyncAt, zones.length, durationMs);

    return { zoneCount: zones.length, durationMs, lastSyncAt };
  } finally {
    syncLocks.delete(key);
  }
}

// ---- Query ----

export interface CachedZonesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  kind?: string;
  dnssec?: 'enabled' | 'disabled';
  scope?: 'forward' | 'reverse';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedZones {
  items: ZoneListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  forwardTotal: number;
  reverseTotal: number;
}

const ALLOWED_SORT_COLUMNS = new Set(['name', 'kind', 'serial', 'edited_serial', 'account', 'last_check', 'dnssec']);

export function getCachedZones(
  serverUrl: string,
  params: CachedZonesParams = {},
  allowedAccounts?: string[]
): PaginatedZones {
  const db = getDb();
  const key = normalizeUrl(serverUrl);
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 25));

  // Build WHERE clauses
  const conditions: string[] = ['server_url = ?'];
  const values: (string | number)[] = [key];

  if (params.search) {
    conditions.push('(name LIKE ? OR account LIKE ?)');
    const term = `%${params.search}%`;
    values.push(term, term);
  }

  if (params.kind) {
    conditions.push('kind = ?');
    values.push(params.kind);
  }

  if (params.dnssec === 'enabled') {
    conditions.push('dnssec = 1');
  } else if (params.dnssec === 'disabled') {
    conditions.push('dnssec = 0');
  }

  // RBAC scoping: undefined = unrestricted (Administrator). An empty array means
  // a non-admin with no groups — they can see nothing.
  if (allowedAccounts) {
    if (allowedAccounts.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0, forwardTotal: 0, reverseTotal: 0 };
    }
    conditions.push(`account IN (${allowedAccounts.map(() => '?').join(',')})`);
    values.push(...allowedAccounts);
  }

  // Zone names are stored in PowerDNS canonical form (trailing dot). Match the
  // apex zones explicitly plus dot-prefixed suffixes so forward zones whose last
  // label merely ends in "in-addr"/"ip6" (e.g. `notin-addr.arpa.`) don't match.
  const REVERSE_CONDITION =
    "(name = 'in-addr.arpa.' OR name LIKE '%.in-addr.arpa.' OR name = 'ip6.arpa.' OR name LIKE '%.ip6.arpa.')";

  const baseWhere = conditions.join(' AND ');
  const scopeClause =
    params.scope === 'reverse' ? ` AND ${REVERSE_CONDITION}`
    : params.scope === 'forward' ? ` AND NOT ${REVERSE_CONDITION}`
    : '';
  const where = baseWhere + scopeClause;

  // Sort
  let sortColumn = 'name';
  if (params.sortBy && ALLOWED_SORT_COLUMNS.has(params.sortBy)) {
    sortColumn = params.sortBy;
  }
  const sortOrder = params.sortOrder === 'desc' ? 'DESC' : 'ASC';

  // Per-scope counts under the same filters; total derives from them.
  const reverseTotal = (db.prepare(`SELECT COUNT(*) as total FROM zones WHERE ${baseWhere} AND ${REVERSE_CONDITION}`).get(...values) as { total: number }).total;
  const forwardTotal = (db.prepare(`SELECT COUNT(*) as total FROM zones WHERE ${baseWhere} AND NOT ${REVERSE_CONDITION}`).get(...values) as { total: number }).total;
  const total =
    params.scope === 'reverse' ? reverseTotal
    : params.scope === 'forward' ? forwardTotal
    : forwardTotal + reverseTotal;
  const totalPages = Math.ceil(total / pageSize);

  // Fetch page
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(
    `SELECT id, name, url, kind, dnssec, account, serial, edited_serial, notified_serial, last_check
     FROM zones WHERE ${where}
     ORDER BY ${sortColumn} ${sortOrder}
     LIMIT ? OFFSET ?`
  ).all(...values, pageSize, offset) as Array<{
    id: string;
    name: string;
    url: string;
    kind: string;
    dnssec: number;
    account: string;
    serial: number;
    edited_serial: number;
    notified_serial: number;
    last_check: number;
  }>;

  const items: ZoneListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind as ZoneListItem['kind'],
    dnssec: row.dnssec === 1,
    account: row.account,
    serial: row.serial,
    edited_serial: row.edited_serial,
    notified_serial: row.notified_serial,
    last_check: row.last_check,
  }));

  return { items, total, page, pageSize, totalPages, forwardTotal, reverseTotal };
}

// ---- Stats ----

export interface ZoneStats {
  total: number;
  native: number;
  master: number;
  slave: number;
  producer: number;
  consumer: number;
  dnssecEnabled: number;
}

export function getCachedZoneStats(serverUrl: string, allowedAccounts?: string[]): ZoneStats {
  const db = getDb();
  const key = normalizeUrl(serverUrl);

  const empty: ZoneStats = { total: 0, native: 0, master: 0, slave: 0, producer: 0, consumer: 0, dnssecEnabled: 0 };
  if (allowedAccounts && allowedAccounts.length === 0) return empty;

  const values: (string | number)[] = [key];
  let accountClause = '';
  if (allowedAccounts) {
    accountClause = ` AND account IN (${allowedAccounts.map(() => '?').join(',')})`;
    values.push(...allowedAccounts);
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN kind = 'Native' THEN 1 ELSE 0 END), 0) as native,
      COALESCE(SUM(CASE WHEN kind = 'Master' THEN 1 ELSE 0 END), 0) as master,
      COALESCE(SUM(CASE WHEN kind = 'Slave' THEN 1 ELSE 0 END), 0) as slave,
      COALESCE(SUM(CASE WHEN kind = 'Producer' THEN 1 ELSE 0 END), 0) as producer,
      COALESCE(SUM(CASE WHEN kind = 'Consumer' THEN 1 ELSE 0 END), 0) as consumer,
      COALESCE(SUM(CASE WHEN dnssec = 1 THEN 1 ELSE 0 END), 0) as dnssecEnabled
    FROM zones WHERE server_url = ?${accountClause}
  `).get(...values) as ZoneStats;

  return row;
}

/**
 * Look up a single zone's `account` from the cache by (server_url, id).
 * Returns the account string ('' for an orphan zone) or null if the zone is
 * not cached. Callers treat null as "account unknown" — for RBAC that means a
 * non-admin is denied (safe default) and an admin proceeds.
 */
export function getZoneAccountByIdAndServer(serverUrl: string, zoneId: string): string | null {
  const row = getDb()
    .prepare('SELECT account FROM zones WHERE server_url = ? AND id = ?')
    .get(normalizeUrl(serverUrl), zoneId) as { account: string } | undefined;
  return row ? row.account : null;
}

/** Update the cached `account` for a zone after it is reassigned, so RBAC checks
 *  (which read the cache) don't use a stale account until the next sync. No-op if
 *  the zone isn't cached. */
export function setZoneAccountInCache(serverUrl: string, zoneId: string, account: string): void {
  getDb()
    .prepare('UPDATE zones SET account = ? WHERE server_url = ? AND id = ?')
    .run(account, normalizeUrl(serverUrl), zoneId);
}

// ---- Sync Meta ----

export function getSyncMeta(serverUrl: string): SyncResult | null {
  const db = getDb();
  const key = normalizeUrl(serverUrl);
  const row = db.prepare(
    'SELECT last_sync_at as lastSyncAt, zone_count as zoneCount, sync_duration_ms as durationMs FROM sync_meta WHERE server_url = ?'
  ).get(key) as SyncResult | undefined;
  return row || null;
}

// ---- Invalidation ----

export function removeCachedZone(serverUrl: string, zoneId: string): void {
  const db = getDb();
  const key = normalizeUrl(serverUrl);
  db.prepare('DELETE FROM zones WHERE server_url = ? AND id = ?').run(key, zoneId);
}

export function invalidateCache(serverUrl: string): void {
  const db = getDb();
  const key = normalizeUrl(serverUrl);
  db.prepare('DELETE FROM zones WHERE server_url = ?').run(key);
  db.prepare('DELETE FROM sync_meta WHERE server_url = ?').run(key);
}
