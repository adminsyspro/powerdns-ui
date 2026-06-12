/**
 * Integration framework: compiled-in providers that replicate PowerDNS zones
 * to external services. The first provider is Cloudflare secondary DNS (AXFR);
 * an API-push mode for plans without secondary DNS is a planned second mode,
 * which is why replication mode is part of the per-instance config.
 */

export type IntegrationProvider = 'cloudflare';

// 'axfr': the provider pulls zones from PowerDNS (Cloudflare secondary DNS,
//         Enterprise). 'push': records are pushed via the provider API
//         (works on any plan) — not implemented yet.
export type ReplicationMode = 'axfr' | 'push';

export interface IntegrationConfig {
  mode: ReplicationMode;
  // Cloudflare account the zones live in.
  accountId: string;
  // Public IP[:port defaults to 53] of the PowerDNS primary the provider
  // transfers from (axfr mode).
  primaryIp: string;
  primaryPort: number;
  // Optional TSIG for the transfer (axfr mode). Secret lives in credentials.
  tsigName?: string;
  tsigAlgo?: string;
  // Provider-side ids created lazily by the provider (peer/tsig reuse).
  peerId?: string;
  tsigId?: string;
  // Zone scope: every Master zone, only zones owned by these groups, or an
  // explicit list of zones.
  scope: 'all-master' | 'groups' | 'zones';
  groups: string[];
  // Canonical zone names (trailing dot) when scope === 'zones'.
  zones: string[];
  // Account-level custom nameservers on provisioned zones: 'ignore' never
  // touches the zone setting (manual setups stay as-is), 'enable' enforces
  // the given nameserver set, 'disable' enforces Cloudflare-branded NS.
  customNsMode: 'ignore' | 'enable' | 'disable';
  customNsSet: number;
  // Create the remote zone automatically when a matching zone is created.
  autoProvision: boolean;
  // What to do remotely when the PowerDNS zone disappears.
  deleteMode: 'never' | 'delete';
}

export interface IntegrationRow {
  id: string;
  provider: IntegrationProvider;
  name: string;
  config: IntegrationConfig;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

// 'stale': the link was healthy but its provider-side prerequisites changed
// (peer/TSIG settings edited) — the next sync reprovisions it.
export type IntegrationZoneStatus = 'ok' | 'provisioning' | 'stale' | 'error' | 'orphan';

export interface IntegrationZoneRow {
  integrationId: string;
  serverUrl: string;
  zoneName: string;
  remoteZoneId: string | null;
  status: IntegrationZoneStatus;
  message: string | null;
  updatedAt: number;
}

// Secrets are stored encrypted and never returned to clients.
export interface IntegrationCredentials {
  apiToken: string;
  tsigSecret?: string;
}
