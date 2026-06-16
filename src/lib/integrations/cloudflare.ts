import type { IntegrationConfig, IntegrationCredentials } from './types';
import { acquireCfSlot } from './rate-limit';

/**
 * Minimal Cloudflare v4 API client for secondary DNS (Enterprise):
 * create `type: secondary` zones, attach an AXFR peer pointing at the
 * PowerDNS primary (with optional TSIG), and force transfers. Used by the
 * reconcile engine; never called from client code.
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

const MAX_RETRIES = Math.max(0, Number(process.env.CF_MAX_RETRIES) || 5);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 250);
}

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
  result_info?: { page: number; total_pages: number };
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // Cloudflare error codes from the response envelope (e.g. 409 "already
    // linked"), distinct from the HTTP status.
    public readonly codes: number[] = []
  ) {
    super(message);
  }
}

// Single choke point for ALL Cloudflare HTTP: applies the global rate limiter
// and retries transient failures. Retries 429 for any method (the request was
// not processed) and 5xx/network only for idempotent methods — a POST that may
// have succeeded remotely must not be replayed (would duplicate or 409); the
// idempotent reconcile caller re-runs and rediscovers state instead.
async function cfRequest<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<CfEnvelope<T>> {
  const method = options.method ?? 'GET';
  const idempotent = IDEMPOTENT_METHODS.has(method);

  for (let attempt = 0; ; attempt++) {
    await acquireCfSlot();

    let response: Response;
    try {
      response = await fetch(`${CF_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (networkErr) {
      if (idempotent && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw new CloudflareError(
        `Cloudflare API: network error (${networkErr instanceof Error ? networkErr.message : 'unknown'})`,
        0
      );
    }

    // Decide retry on the HTTP status BEFORE parsing — 429/5xx bodies may not be JSON.
    const is429 = response.status === 429;
    const is5xx = response.status >= 500 && response.status <= 599;
    if ((is429 || (is5xx && idempotent)) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt, response.headers.get('retry-after')));
      continue;
    }

    let envelope: CfEnvelope<T>;
    try {
      envelope = (await response.json()) as CfEnvelope<T>;
    } catch {
      throw new CloudflareError(`Cloudflare API: HTTP ${response.status}`, response.status);
    }
    if (!response.ok || !envelope.success) {
      let detail = envelope.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
      if (envelope.errors?.some((e) => e.code === 1000)) {
        detail += ' — make sure you pasted an API Token value (My Profile > API Tokens > Create Token), not the Global API Key or the token ID';
      }
      throw new CloudflareError(`Cloudflare API: ${detail}`, response.status, envelope.errors?.map((e) => e.code) ?? []);
    }
    return envelope;
  }
}

async function cf<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  return (await cfRequest<T>(token, path, options)).result;
}

export interface CfZone {
  id: string;
  name: string;
  type: string;
  status: string;
  plan?: { id: string; name?: string };
}

export async function verifyToken(creds: IntegrationCredentials, accountId?: string): Promise<void> {
  try {
    await cf<{ status: string }>(creds.apiToken, '/user/tokens/verify');
  } catch (e) {
    // Account Owned Tokens (cfat_…) are rejected by the user endpoint with
    // error 1000 even when valid; they verify against the account endpoint.
    if (accountId && e instanceof CloudflareError) {
      await cf<{ status: string }>(creds.apiToken, `/accounts/${encodeURIComponent(accountId)}/tokens/verify`);
      return;
    }
    throw e;
  }
}

export async function listZones(creds: IntegrationCredentials, accountId: string): Promise<CfZone[]> {
  const zones: CfZone[] = [];
  // 50 zones/page; loop with a hard cap so a huge account can't spin forever.
  for (let page = 1; page <= 200; page++) {
    const envelope = await cfRequest<CfZone[]>(
      creds.apiToken,
      `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50&page=${page}`
    );
    zones.push(...envelope.result);
    if (!envelope.result_info || envelope.result_info.page >= envelope.result_info.total_pages) break;
  }
  return zones;
}

interface CfPeer {
  id: string;
  name: string;
  ip?: string;
  port?: number;
  tsig_id?: string;
}

/**
 * Ensures the account-level transfer prerequisites exist (TSIG key + peer
 * pointing at the PowerDNS primary) and returns their ids. An existing peer
 * with the same IP/port (and matching TSIG expectation) is reused so manual
 * setups that predate the integration are adopted instead of duplicated —
 * relinking a zone already attached to that peer is then a no-op. Ids are
 * persisted back into the integration config by the caller.
 */
export async function ensurePeer(
  creds: IntegrationCredentials,
  config: IntegrationConfig
): Promise<{ peerId: string; tsigId?: string }> {
  let tsigId = config.tsigId;
  if (!tsigId && config.tsigName && creds.tsigSecret) {
    const tsig = await cf<{ id: string }>(creds.apiToken, `/accounts/${config.accountId}/secondary_dns/tsigs`, {
      method: 'POST',
      body: {
        name: config.tsigName,
        algo: config.tsigAlgo || 'hmac-sha256.',
        secret: creds.tsigSecret,
      },
    });
    tsigId = tsig.id;
  }

  if (config.peerId) return { peerId: config.peerId, tsigId };

  // Reuse an existing matching peer. Without a configured TSIG we can only
  // adopt a peer that has none; with one we can't verify the remote secret,
  // so we only adopt the peer when it references the TSIG we just created
  // (never the case) — i.e. TSIG setups always get their own peer.
  // Paginated like the other list helpers: a match on a later page must not
  // fall through to creating a duplicate.
  const existing: CfPeer[] = [];
  for (let page = 1; page <= 100; page++) {
    const envelope = await cfRequest<CfPeer[]>(
      creds.apiToken,
      `/accounts/${encodeURIComponent(config.accountId)}/secondary_dns/peers?per_page=100&page=${page}`
    );
    existing.push(...envelope.result);
    if (!envelope.result_info || envelope.result_info.page >= envelope.result_info.total_pages) break;
  }
  const wantPort = config.primaryPort || 53;
  const match = existing.find(
    (peer) =>
      peer.ip === config.primaryIp &&
      (peer.port ?? 53) === wantPort &&
      (tsigId ? peer.tsig_id === tsigId : !peer.tsig_id)
  );
  if (match) return { peerId: match.id, tsigId };

  const peer = await cf<{ id: string }>(creds.apiToken, `/accounts/${config.accountId}/secondary_dns/peers`, {
    method: 'POST',
    body: {
      name: `powerdns-ui ${config.primaryIp}`,
      ip: config.primaryIp,
      port: wantPort,
      ...(tsigId ? { tsig_id: tsigId } : {}),
    },
  });
  return { peerId: peer.id, tsigId };
}

export async function getZoneByName(
  creds: IntegrationCredentials,
  accountId: string,
  zoneName: string
): Promise<CfZone | undefined> {
  const result = await cf<CfZone[]>(
    creds.apiToken,
    `/zones?account.id=${encodeURIComponent(accountId)}&name=${encodeURIComponent(zoneName)}`
  );
  return result[0];
}

const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

export interface ZoneUniqueVisitors {
  points: Array<{ date: string; uniques: number }>;
  total: number;
}

/**
 * Daily unique HTTP visitors for a zone over the last `days` days, via the
 * Cloudflare GraphQL Analytics API (httpRequests1dGroups → uniq.uniques).
 * The window is the last `days` calendar days ending today (today's point may
 * be partial). Returns null when analytics are unavailable — token lacks
 * Account Analytics:Read, the zone has no proxied HTTP traffic, GraphQL returns
 * errors, or the request fails — so callers render "No data" rather than erroring.
 */
export async function getZoneUniqueVisitors(
  creds: IntegrationCredentials,
  cfZoneId: string,
  days = 30
): Promise<ZoneUniqueVisitors | null> {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  // Cloudflare's GraphQL schema uses custom scalars: zoneTag is `string`
  // (not the built-in String) and date_geq/date_leq are `Date`. `limit` must be
  // a literal (Cloudflare types it as uint64, which a built-in Int variable does
  // not satisfy), so it is inlined — days is a controlled integer. Getting these
  // wrong fails query validation, which would surface as errors → null → "No data".
  const query = `query Uniques($zoneTag: string!, $since: Date!, $until: Date!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        httpRequests1dGroups(limit: ${days + 1}, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
          dimensions { date }
          uniq { uniques }
        }
      }
    }
  }`;
  try {
    await acquireCfSlot();
    const response = await fetch(CF_GRAPHQL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { zoneTag: cfZoneId, since: fmt(since), until: fmt(until) },
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: { viewer?: { zones?: Array<{ httpRequests1dGroups?: Array<{ dimensions: { date: string }; uniq: { uniques: number } }> }> } };
      errors?: unknown[];
    };
    if (Array.isArray(json.errors) && json.errors.length > 0) return null;
    const groups = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
    if (!Array.isArray(groups)) return null;
    const points = groups.map((g) => ({ date: g.dimensions.date, uniques: g.uniq?.uniques ?? 0 }));
    const total = points.reduce((sum, p) => sum + p.uniques, 0);
    return { points, total };
  } catch {
    return null;
  }
}

/**
 * Daily unique HTTP visitors for MANY zones (one integration's zones) over the
 * last `days` days, via a single aliased Cloudflare GraphQL query per chunk.
 * Each zone is queried in its own aliased `zones(filter:{zoneTag})` block (z0,
 * z1, …) so results map back by alias — no dependency on `zoneTag` being a
 * selectable output field, and no reliance on result ordering. Returns a
 * Map<cfZoneId, {points,total}> (ids with no data are absent), or null on any
 * failure so the caller degrades the whole batch to "No data".
 */
export async function getZonesUniqueVisitors(
  creds: IntegrationCredentials,
  cfZoneIds: string[],
  days = 30
): Promise<Map<string, ZoneUniqueVisitors> | null> {
  const ids = cfZoneIds.filter((id) => /^[a-f0-9]{32}$/i.test(id));
  if (ids.length === 0) return new Map();
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const CHUNK = 50;
  const result = new Map<string, ZoneUniqueVisitors>();

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const blocks = chunk.map((id, n) =>
      `z${n}: zones(filter: { zoneTag: "${id}" }) { httpRequests1dGroups(limit: ${days + 1}, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) { dimensions { date } uniq { uniques } } }`
    ).join('\n');
    const query = `query Uniques($since: Date!, $until: Date!) { viewer { ${blocks} } }`;
    try {
      await acquireCfSlot();
      const response = await fetch(CF_GRAPHQL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { since: fmt(since), until: fmt(until) } }),
      });
      if (!response.ok) return null;
      const json = (await response.json()) as {
        data?: { viewer?: Record<string, Array<{ httpRequests1dGroups?: Array<{ dimensions: { date: string }; uniq: { uniques: number } }> }>> };
        errors?: unknown[];
      };
      if (Array.isArray(json.errors) && json.errors.length > 0) return null;
      const viewer = json.data?.viewer;
      if (!viewer) return null;
      chunk.forEach((id, n) => {
        const groups = viewer[`z${n}`]?.[0]?.httpRequests1dGroups;
        if (!Array.isArray(groups)) return;
        const points = groups.map((g) => ({ date: g.dimensions.date, uniques: g.uniq?.uniques ?? 0 }));
        const total = points.reduce((sum, p) => sum + p.uniques, 0);
        result.set(id, { points, total });
      });
    } catch {
      return null;
    }
  }
  return result;
}

export async function createSecondaryZone(
  creds: IntegrationCredentials,
  accountId: string,
  zoneName: string
): Promise<CfZone> {
  return cf<CfZone>(creds.apiToken, '/zones', {
    method: 'POST',
    body: { name: zoneName, account: { id: accountId }, type: 'secondary' },
  });
}

/** Reads a zone's incoming-transfer config; undefined when none is set. */
export async function getZoneIncoming(
  creds: IntegrationCredentials,
  cfZoneId: string
): Promise<{ peers?: string[] } | undefined> {
  try {
    return await cf<{ peers?: string[] }>(creds.apiToken, `/zones/${cfZoneId}/secondary_dns/incoming`);
  } catch (e) {
    if (e instanceof CloudflareError && e.status === 404) return undefined;
    throw e;
  }
}

export async function linkZoneToPeer(
  creds: IntegrationCredentials,
  cfZoneId: string,
  zoneName: string,
  peerId: string
): Promise<void> {
  await cf(creds.apiToken, `/zones/${cfZoneId}/secondary_dns/incoming`, {
    method: 'POST',
    body: { name: zoneName, peers: [peerId], auto_refresh_seconds: 86400 },
  });
}

export async function forceAxfr(creds: IntegrationCredentials, cfZoneId: string): Promise<void> {
  await cf(creds.apiToken, `/zones/${cfZoneId}/secondary_dns/force_axfr`, { method: 'POST' });
}

export async function deleteZone(creds: IntegrationCredentials, cfZoneId: string): Promise<void> {
  try {
    await cf(creds.apiToken, `/zones/${cfZoneId}`, { method: 'DELETE' });
  } catch (e) {
    // Both mean the zone is already gone, which is the desired end state:
    // HTTP 404, or Cloudflare code 1001 "Invalid zone identifier" (returned as
    // HTTP 400 once the id no longer resolves — e.g. the zone was also deleted
    // manually at Cloudflare). Treating 1001 as success lets a stuck orphan be
    // removed locally instead of looping on "Remote deletion failed — will retry".
    if (e instanceof CloudflareError && (e.status === 404 || e.codes.includes(1001))) return;
    throw e;
  }
}

export interface CfAccountCustomNs {
  ns_name: string;
  ns_set: number;
  // A/AAAA records Cloudflare reports for this custom nameserver (the real IPs).
  dns_records?: Array<{ type?: 'A' | 'AAAA'; value?: string }>;
}

/** Lists the account-level custom nameservers (each entry belongs to a set). */
export async function listAccountCustomNs(
  creds: IntegrationCredentials,
  accountId: string
): Promise<CfAccountCustomNs[]> {
  const entries: CfAccountCustomNs[] = [];
  for (let page = 1; page <= 20; page++) {
    const envelope = await cfRequest<CfAccountCustomNs[]>(
      creds.apiToken,
      `/accounts/${encodeURIComponent(accountId)}/custom_ns?per_page=100&page=${page}`
    );
    entries.push(...envelope.result);
    if (!envelope.result_info || envelope.result_info.page >= envelope.result_info.total_pages) break;
  }
  return entries;
}

/** Puts the zone on the Enterprise plan (Cloudflare Secondary DNS is Enterprise-only). */
export async function setZonePlan(creds: IntegrationCredentials, cfZoneId: string): Promise<void> {
  await cf(creds.apiToken, `/zones/${cfZoneId}/subscription`, {
    method: 'POST',
    body: { rate_plan: { id: 'enterprise' } },
  });
}

/**
 * Enables/disables "Secondary DNS override" (secondary_overrides) so a secondary
 * zone can serve proxied override records. Requires DNSSEC Unsigned or Live Signing.
 */
export async function setSecondaryOverride(
  creds: IntegrationCredentials,
  cfZoneId: string,
  enabled: boolean
): Promise<void> {
  await cf(creds.apiToken, `/zones/${cfZoneId}/dns_settings`, {
    method: 'PATCH',
    body: { secondary_overrides: enabled },
  });
}

/**
 * Enables/disables the account-level custom nameservers for a zone (the
 * "Custom Nameservers" sets configured on the Cloudflare account).
 */
export async function setZoneCustomNs(
  creds: IntegrationCredentials,
  cfZoneId: string,
  enabled: boolean,
  nsSet: number
): Promise<void> {
  await cf(creds.apiToken, `/zones/${cfZoneId}/custom_ns`, {
    method: 'PUT',
    body: enabled ? { enabled: true, ns_set: nsSet } : { enabled: false },
  });
}

/**
 * Reads a zone's current custom nameserver set. Returns the set number when the
 * zone uses an account custom-NS set, or null for Cloudflare-default nameservers.
 * Best-effort: any error or missing field yields null (callers treat null as
 * "Cloudflare default / unknown" and never break on it).
 */
export async function getZoneCustomNs(creds: IntegrationCredentials, cfZoneId: string): Promise<number | null> {
  try {
    const settings = await cf<{ nameservers?: { type?: string; ns_set?: number } }>(
      creds.apiToken,
      `/zones/${cfZoneId}/dns_settings`
    );
    const nsSet = settings.nameservers?.ns_set;
    return typeof nsSet === 'number' ? nsSet : null;
  } catch {
    return null;
  }
}

// ---- DNS records (proxy / orange cloud) ----

export interface CfDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  proxiable: boolean;
}

export async function listDnsRecords(
  creds: IntegrationCredentials,
  cfZoneId: string
): Promise<CfDnsRecord[]> {
  const records: CfDnsRecord[] = [];
  for (let page = 1; page <= 100; page++) {
    const envelope = await cfRequest<CfDnsRecord[]>(
      creds.apiToken,
      `/zones/${cfZoneId}/dns_records?per_page=100&page=${page}`
    );
    records.push(...envelope.result);
    if (!envelope.result_info || envelope.result_info.page >= envelope.result_info.total_pages) break;
  }
  return records;
}

export async function setRecordProxied(
  creds: IntegrationCredentials,
  cfZoneId: string,
  recordId: string,
  proxied: boolean
): Promise<void> {
  await cf(creds.apiToken, `/zones/${cfZoneId}/dns_records/${recordId}`, {
    method: 'PATCH',
    body: { proxied },
  });
}
