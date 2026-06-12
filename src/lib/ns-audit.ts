import dns from 'dns/promises';
import { getDb } from '@/lib/cache/db';
import { normalizeNameserverPools, getDefaultNameserverPool } from '@/lib/ns-pools';
import type { NameserverPool } from '@/lib/ns-pools';

/**
 * NS compliance audit: compares each forward zone's PUBLIC delegation (live
 * dns.resolveNs, same source as the zone-page header) against the default
 * nameserver pool configured in Administration > Settings. Results are
 * persisted in SQLite so the audit page loads instantly between scans.
 */

export type NsAuditStatus = 'ok' | 'foreign' | 'mixed' | 'incomplete' | 'no-ns' | 'error';

export interface NsAuditRow {
  zoneId: string;
  zoneName: string;
  status: NsAuditStatus;
  delegated: string[];
  inPool: string[];
  extra: string[];
  missing: string[];
  error: string | null;
  checkedAt: number;
}

export interface NsAuditScanState {
  running: boolean;
  total: number;
  scanned: number;
  startedAt: number | null;
  finishedAt: number | null;
  poolName: string | null;
  poolNameservers: string[];
  error: string | null;
}

const LOOKUP_TIMEOUT_MS = 5000;
const CONCURRENCY = 10;

// One scan at a time per process; the audit page polls this state.
const scanStates = new Map<string, NsAuditScanState>();

function emptyState(): NsAuditScanState {
  return {
    running: false,
    total: 0,
    scanned: 0,
    startedAt: null,
    finishedAt: null,
    poolName: null,
    poolNameservers: [],
    error: null,
  };
}

export function getScanState(serverUrl: string): NsAuditScanState {
  return scanStates.get(serverUrl) ?? emptyState();
}

// Compare names without trailing dot and case-insensitively: pools store
// "ns0.example.com." while resolveNs returns "ns0.example.com".
function canon(ns: string): string {
  return ns.trim().toLowerCase().replace(/\.$/, '');
}

export function classifyDelegation(
  delegated: string[],
  pool: string[]
): { status: NsAuditStatus; inPool: string[]; extra: string[]; missing: string[] } {
  const poolSet = new Set(pool.map(canon));
  const delegatedSet = new Set(delegated.map(canon));
  const inPool = [...delegatedSet].filter((ns) => poolSet.has(ns));
  const extra = [...delegatedSet].filter((ns) => !poolSet.has(ns));
  const missing = [...poolSet].filter((ns) => !delegatedSet.has(ns));

  let status: NsAuditStatus;
  if (delegatedSet.size === 0) status = 'no-ns';
  else if (inPool.length === 0) status = 'foreign';
  else if (extra.length > 0) status = 'mixed';
  else if (missing.length > 0) status = 'incomplete';
  else status = 'ok';

  return { status, inPool, extra, missing };
}

function readDefaultPool(): NameserverPool | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ns_pools'").get() as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  try {
    return getDefaultNameserverPool(normalizeNameserverPools(JSON.parse(row.value)));
  } catch {
    return undefined;
  }
}

async function resolveDelegatedNs(zoneName: string): Promise<{ ns: string[]; error: string | null }> {
  const domain = zoneName.replace(/\.$/, '');
  try {
    const ns = await Promise.race<string[]>([
      dns.resolveNs(domain),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('lookup timeout')), LOOKUP_TIMEOUT_MS)
      ),
    ]);
    return { ns: ns.sort((a, b) => a.localeCompare(b)), error: null };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // Not delegated / nonexistent domains are a classification, not a failure.
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENOTIMP') {
      return { ns: [], error: null };
    }
    return { ns: [], error: e instanceof Error ? e.message : 'lookup failed' };
  }
}

function upsertResult(serverUrl: string, row: NsAuditRow): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO ns_audit
       (server_url, zone_id, zone_name, status, delegated, in_pool, extra, missing, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    serverUrl,
    row.zoneId,
    row.zoneName,
    row.status,
    JSON.stringify(row.delegated),
    JSON.stringify(row.inPool),
    JSON.stringify(row.extra),
    JSON.stringify(row.missing),
    row.error,
    row.checkedAt
  );
}

/**
 * Starts a scan of every forward zone cached for this server. Returns false
 * when a scan is already running. The scan itself runs detached; callers poll
 * getScanState() / getAuditResults() for progress and results.
 */
export function startScan(serverUrl: string): { started: boolean; reason?: string } {
  const current = getScanState(serverUrl);
  if (current.running) return { started: false, reason: 'A scan is already running' };

  const pool = readDefaultPool();
  if (!pool) {
    return { started: false, reason: 'No nameserver pool configured (Administration > Settings)' };
  }

  const db = getDb();
  // Reverse zones are managed delegations with a different compliance model;
  // the audit targets customer-facing forward zones only.
  const zones = db
    .prepare(
      `SELECT id, name FROM zones
        WHERE server_url = ?
          AND NOT (name = 'in-addr.arpa.' OR name LIKE '%.in-addr.arpa.' OR name = 'ip6.arpa.' OR name LIKE '%.ip6.arpa.')
        ORDER BY name`
    )
    .all(serverUrl) as Array<{ id: string; name: string }>;

  const state: NsAuditScanState = {
    running: true,
    total: zones.length,
    scanned: 0,
    startedAt: Date.now(),
    finishedAt: null,
    poolName: pool.name,
    poolNameservers: pool.nameservers,
    error: null,
  };
  scanStates.set(serverUrl, state);

  // Stale results for zones that no longer exist would linger forever.
  db.prepare(
    `DELETE FROM ns_audit WHERE server_url = ? AND zone_id NOT IN (SELECT id FROM zones WHERE server_url = ?)`
  ).run(serverUrl, serverUrl);

  void runScan(serverUrl, zones, pool.nameservers, state);
  return { started: true };
}

async function runScan(
  serverUrl: string,
  zones: Array<{ id: string; name: string }>,
  poolNameservers: string[],
  state: NsAuditScanState
): Promise<void> {
  try {
    let index = 0;
    const worker = async () => {
      while (index < zones.length) {
        const zone = zones[index++];
        const { ns, error } = await resolveDelegatedNs(zone.name);
        const { status, inPool, extra, missing } = classifyDelegation(ns, poolNameservers);
        upsertResult(serverUrl, {
          zoneId: zone.id,
          zoneName: zone.name,
          status: error ? 'error' : status,
          delegated: ns,
          inPool,
          extra,
          missing,
          error,
          checkedAt: Date.now(),
        });
        state.scanned++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, zones.length) }, worker));
  } catch (e) {
    state.error = e instanceof Error ? e.message : 'scan failed';
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
  }
}

export interface NsAuditResults {
  results: NsAuditRow[];
  counts: Record<NsAuditStatus, number>;
  lastCheckedAt: number | null;
}

export function getAuditResults(serverUrl: string): NsAuditResults {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT zone_id, zone_name, status, delegated, in_pool, extra, missing, error, checked_at
         FROM ns_audit WHERE server_url = ? ORDER BY zone_name`
    )
    .all(serverUrl) as Array<{
      zone_id: string;
      zone_name: string;
      status: NsAuditStatus;
      delegated: string;
      in_pool: string;
      extra: string;
      missing: string;
      error: string | null;
      checked_at: number;
    }>;

  const parse = (value: string): string[] => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const counts: Record<NsAuditStatus, number> = {
    ok: 0, foreign: 0, mixed: 0, incomplete: 0, 'no-ns': 0, error: 0,
  };
  let lastCheckedAt: number | null = null;

  const results = rows.map((row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    if (lastCheckedAt === null || row.checked_at > lastCheckedAt) lastCheckedAt = row.checked_at;
    return {
      zoneId: row.zone_id,
      zoneName: row.zone_name,
      status: row.status,
      delegated: parse(row.delegated),
      inPool: parse(row.in_pool),
      extra: parse(row.extra),
      missing: parse(row.missing),
      error: row.error,
      checkedAt: row.checked_at,
    };
  });

  return { results, counts, lastCheckedAt };
}
