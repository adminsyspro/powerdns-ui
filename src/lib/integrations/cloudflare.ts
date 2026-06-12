import type { IntegrationConfig, IntegrationCredentials } from './types';

/**
 * Minimal Cloudflare v4 API client for secondary DNS (Enterprise):
 * create `type: secondary` zones, attach an AXFR peer pointing at the
 * PowerDNS primary (with optional TSIG), and force transfers. Used by the
 * reconcile engine; never called from client code.
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
  result_info?: { page: number; total_pages: number };
}

export class CloudflareError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function cf<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${CF_API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let envelope: CfEnvelope<T>;
  try {
    envelope = (await response.json()) as CfEnvelope<T>;
  } catch {
    throw new CloudflareError(`Cloudflare API: HTTP ${response.status}`, response.status);
  }
  if (!response.ok || !envelope.success) {
    let detail = envelope.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
    // Error 1000 means Cloudflare did not recognize the Bearer value at all —
    // almost always a Global API Key or a token ID pasted instead of the
    // token value (shown only once at creation).
    if (envelope.errors?.some((e) => e.code === 1000)) {
      detail += ' — make sure you pasted an API Token value (My Profile > API Tokens > Create Token), not the Global API Key or the token ID';
    }
    throw new CloudflareError(`Cloudflare API: ${detail}`, response.status);
  }
  return envelope.result;
}

export interface CfZone {
  id: string;
  name: string;
  type: string;
  status: string;
}

export async function verifyToken(creds: IntegrationCredentials): Promise<void> {
  await cf<{ status: string }>(creds.apiToken, '/user/tokens/verify');
}

export async function listZones(creds: IntegrationCredentials, accountId: string): Promise<CfZone[]> {
  const zones: CfZone[] = [];
  // 50 zones/page; loop with a hard cap so a huge account can't spin forever.
  for (let page = 1; page <= 200; page++) {
    const response = await fetch(
      `${CF_API}/zones?account.id=${encodeURIComponent(accountId)}&per_page=50&page=${page}`,
      { headers: { Authorization: `Bearer ${creds.apiToken}` } }
    );
    const envelope = (await response.json()) as CfEnvelope<CfZone[]>;
    if (!response.ok || !envelope.success) {
      const detail = envelope.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
      throw new CloudflareError(`Cloudflare API: ${detail}`, response.status);
    }
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
    const response = await fetch(
      `${CF_API}/accounts/${encodeURIComponent(config.accountId)}/secondary_dns/peers?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${creds.apiToken}` } }
    );
    const envelope = (await response.json()) as CfEnvelope<CfPeer[]>;
    if (!response.ok || !envelope.success) {
      const detail = envelope.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
      throw new CloudflareError(`Cloudflare API: ${detail}`, response.status);
    }
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
  await cf(creds.apiToken, `/zones/${cfZoneId}`, { method: 'DELETE' });
}

export interface CfAccountCustomNs {
  ns_name: string;
  ns_set: number;
}

/** Lists the account-level custom nameservers (each entry belongs to a set). */
export async function listAccountCustomNs(
  creds: IntegrationCredentials,
  accountId: string
): Promise<CfAccountCustomNs[]> {
  const entries: CfAccountCustomNs[] = [];
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(
      `${CF_API}/accounts/${encodeURIComponent(accountId)}/custom_ns?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${creds.apiToken}` } }
    );
    const envelope = (await response.json()) as CfEnvelope<CfAccountCustomNs[]>;
    if (!response.ok || !envelope.success) {
      const detail = envelope.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
      throw new CloudflareError(`Cloudflare API: ${detail}`, response.status);
    }
    entries.push(...envelope.result);
    if (!envelope.result_info || envelope.result_info.page >= envelope.result_info.total_pages) break;
  }
  return entries;
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
    const response = await fetch(
      `${CF_API}/zones/${cfZoneId}/dns_records?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${creds.apiToken}` } }
    );
    const envelope = (await response.json()) as CfEnvelope<CfDnsRecord[]>;
    if (!response.ok || !envelope.success) {
      const detail = envelope.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${response.status}`;
      throw new CloudflareError(`Cloudflare API: ${detail}`, response.status);
    }
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
