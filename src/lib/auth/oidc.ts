import { getDb } from '@/lib/cache/db';
import { encrypt, decrypt } from '@/lib/crypto';
import type { UserRole } from '@/types/powerdns';
import * as client from 'openid-client';

const VALID_ROLES: UserRole[] = ['Administrator', 'Operator', 'User', 'Customer'];
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const DEFAULTS = {
  providerName: 'SSO',
  scopes: 'openid profile email groups',
  claimEmail: 'email',
  claimName: 'name',
  claimGroups: 'groups',
  defaultRole: 'User' as UserRole,
};

/**
 * Canonical, externally-reachable base origin for OIDC redirect URIs and
 * post-login redirects.
 *
 * Behind a reverse proxy the Node server only sees its internal bind address
 * (e.g. http://0.0.0.0:3000), so `request.url` cannot be trusted for anything
 * the browser or the IdP must reach back to. Resolution order:
 *   1. the explicit override saved in the OIDC settings UI (app_settings) —
 *      takes effect immediately, no rebuild/redeploy;
 *   2. the runtime environment (APP_URL, then NEXT_PUBLIC_APP_URL);
 *   3. the request origin (local dev / direct access).
 *
 * The env is read through a dynamic key on purpose: a literal
 * `process.env.NEXT_PUBLIC_APP_URL` is inlined by Next.js at BUILD time and
 * frozen into the server bundle, so an image built once could not be deployed
 * under a different public URL. A computed lookup is left untouched by the
 * compiler and therefore resolves against the live process.env at request time.
 *
 * Only the origin (scheme + host + port) is used — any path/query in the
 * configured value is discarded so a trailing slash can't corrupt the callback.
 */
export function getPublicBaseUrl(requestUrl: string): string {
  // 1) Explicit override from the OIDC settings UI.
  try {
    const fromDb = getSetting('oidc_app_base_url');
    if (fromDb) return new URL(fromDb).origin;
  } catch {
    // DB not ready (e.g. at build time) — fall through to env/request.
  }
  // 2) Runtime environment (dynamic key avoids build-time inlining).
  const env = (k: string): string | undefined => process.env[k];
  const configured = env('APP_URL') || env('NEXT_PUBLIC_APP_URL');
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // malformed env value — ignore and fall back to the request origin
    }
  }
  // 3) Request origin.
  return new URL(requestUrl).origin;
}

export interface OidcConfig {
  enabled: boolean;
  providerName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string; // decrypted; '' if unset
  scopes: string;
  claimEmail: string;
  claimName: string;
  claimGroups: string;
  autoProvision: boolean;
  defaultRole: UserRole;
  requireAppGroupMatch: boolean;
  groupRoleMapping: Record<string, string>;
  groupAppGroupsMapping: Record<string, string[]>;
  showLocalLogin: boolean;
  forceSsoRedirect: boolean;
  /** Public origin override for the redirect_uri; '' = fall back to env/request. */
  appBaseUrl: string;
}

function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}
function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

function safeJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Trim keys/values, drop empties and prototype-pollution keys. */
function normalizeStringMap(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).trim();
    if (!key || DANGEROUS_KEYS.has(key)) continue;
    const val = typeof v === 'string' ? v.trim() : '';
    if (val) out[key] = val;
  }
  return out;
}
function normalizeGroupsMap(input: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).trim();
    if (!key || DANGEROUS_KEYS.has(key)) continue;
    const arr = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    if (arr.length) out[key] = arr;
  }
  return out;
}

export function isOidcEnabled(): boolean {
  return getSetting('oidc_enabled') === 'true';
}

export function getOidcConfig(): OidcConfig {
  const enc = getSetting('oidc_client_secret');
  const rawDefaultRole = getSetting('oidc_default_role');
  return {
    enabled: getSetting('oidc_enabled') === 'true',
    providerName: getSetting('oidc_provider_name') || DEFAULTS.providerName,
    issuerUrl: getSetting('oidc_issuer_url') || '',
    clientId: getSetting('oidc_client_id') || '',
    clientSecret: enc ? decrypt(enc) : '',
    scopes: getSetting('oidc_scopes') || DEFAULTS.scopes,
    claimEmail: getSetting('oidc_claim_email') || DEFAULTS.claimEmail,
    claimName: getSetting('oidc_claim_name') || DEFAULTS.claimName,
    claimGroups: getSetting('oidc_claim_groups') || DEFAULTS.claimGroups,
    autoProvision: (getSetting('oidc_auto_provision') ?? 'true') === 'true',
    defaultRole: VALID_ROLES.includes(rawDefaultRole as UserRole)
      ? (rawDefaultRole as UserRole)
      : DEFAULTS.defaultRole,
    requireAppGroupMatch: getSetting('oidc_require_app_group_match') === 'true',
    groupRoleMapping: normalizeStringMap(safeJsonObject(getSetting('oidc_group_role_mapping'))),
    groupAppGroupsMapping: normalizeGroupsMap(safeJsonObject(getSetting('oidc_group_app_groups_mapping'))),
    showLocalLogin: (getSetting('oidc_show_local_login') ?? 'true') === 'true',
    forceSsoRedirect: getSetting('oidc_force_sso_redirect') === 'true',
    appBaseUrl: getSetting('oidc_app_base_url') || '',
  };
}

export interface OidcPublicInfo {
  enabled: boolean;
  providerName: string;
  showLocalLogin: boolean;
  forceSsoRedirect: boolean;
}
/** Safe subset for the public /api/auth/providers endpoint (no secret).
 *  Enforces the anti-lockout invariant when disabled. */
export function getPublicOidcInfo(): OidcPublicInfo {
  const c = getOidcConfig();
  return {
    enabled: c.enabled,
    providerName: c.providerName,
    showLocalLogin: c.enabled ? c.showLocalLogin : true,
    forceSsoRedirect: c.enabled ? c.forceSsoRedirect : false,
  };
}

export interface OidcSaveInput {
  enabled?: boolean;
  providerName?: string;
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string; // only persisted when a non-empty string is provided
  scopes?: string;
  claimEmail?: string;
  claimName?: string;
  claimGroups?: string;
  autoProvision?: boolean;
  defaultRole?: string;
  requireAppGroupMatch?: boolean;
  groupRoleMapping?: unknown;
  groupAppGroupsMapping?: unknown;
  showLocalLogin?: boolean;
  forceSsoRedirect?: boolean;
  appBaseUrl?: string;
}

/** Persist OIDC config. Encrypts the client secret only when a new one is provided
 *  (blank keeps the existing one). Enforces the anti-lockout invariant: when OIDC is
 *  disabled, the local login form is forced visible and SSO redirect is forced off. */
export function saveOidcConfig(input: OidcSaveInput): void {
  const enabled = !!input.enabled;
  const showLocalLogin = enabled ? !!input.showLocalLogin : true;
  const forceSsoRedirect = enabled ? !!input.forceSsoRedirect : false;

  setSetting('oidc_enabled', enabled ? 'true' : 'false');
  setSetting('oidc_provider_name', (String(input.providerName ?? '').trim()) || DEFAULTS.providerName);
  setSetting('oidc_issuer_url', String(input.issuerUrl ?? '').trim());
  setSetting('oidc_client_id', String(input.clientId ?? '').trim());
  if (typeof input.clientSecret === 'string' && input.clientSecret.length > 0) {
    setSetting('oidc_client_secret', encrypt(input.clientSecret));
  }
  setSetting('oidc_scopes', (String(input.scopes ?? '').trim()) || DEFAULTS.scopes);
  setSetting('oidc_claim_email', (String(input.claimEmail ?? '').trim()) || DEFAULTS.claimEmail);
  setSetting('oidc_claim_name', (String(input.claimName ?? '').trim()) || DEFAULTS.claimName);
  setSetting('oidc_claim_groups', (String(input.claimGroups ?? '').trim()) || DEFAULTS.claimGroups);
  setSetting('oidc_auto_provision', input.autoProvision === false ? 'false' : 'true');
  const role = VALID_ROLES.includes(input.defaultRole as UserRole)
    ? (input.defaultRole as UserRole)
    : DEFAULTS.defaultRole;
  setSetting('oidc_default_role', role);
  setSetting('oidc_require_app_group_match', input.requireAppGroupMatch ? 'true' : 'false');
  setSetting(
    'oidc_group_role_mapping',
    JSON.stringify(normalizeStringMap(asObject(input.groupRoleMapping)))
  );
  setSetting(
    'oidc_group_app_groups_mapping',
    JSON.stringify(normalizeGroupsMap(asObject(input.groupAppGroupsMapping)))
  );
  setSetting('oidc_show_local_login', showLocalLogin ? 'true' : 'false');
  setSetting('oidc_force_sso_redirect', forceSsoRedirect ? 'true' : 'false');
  setSetting('oidc_app_base_url', normalizeBaseUrl(input.appBaseUrl));
  cachedConfig = null;
}

/** Normalize a user-supplied base URL to its http(s) origin; '' when blank or
 *  not a usable web origin (e.g. mailto:/urn: parse fine but have a null origin). */
function normalizeBaseUrl(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

/** Accept either a JSON string or an object for the mapping inputs. */
function asObject(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') return safeJsonObject(v);
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

/** Coerce an IdP groups claim (array or space/comma string) into a clean string[]. */
export function extractGroupsFromClaim(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map((x) => String(x).trim()).filter(Boolean);
  if (typeof claim === 'string') return claim.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** First IdP group that maps to a valid role wins; else the configured default. */
export function resolveOidcRole(groups: string[], cfg: OidcConfig): UserRole {
  for (const g of groups) {
    if (!Object.prototype.hasOwnProperty.call(cfg.groupRoleMapping, g)) continue;
    const mapped = cfg.groupRoleMapping[g];
    if (mapped && VALID_ROLES.includes(mapped as UserRole)) return mapped as UserRole;
  }
  return cfg.defaultRole;
}

/** Union of app-group slugs the user's IdP groups map to. */
export function resolveOidcAppGroups(groups: string[], cfg: OidcConfig): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    if (!Object.prototype.hasOwnProperty.call(cfg.groupAppGroupsMapping, g)) continue;
    const slugs = cfg.groupAppGroupsMapping[g];
    if (Array.isArray(slugs)) for (const s of slugs) out.add(s);
  }
  return [...out];
}

// --- Discovery (cached ~60s) ---
let cachedConfig: { key: string; at: number; config: client.Configuration } | null = null;

/** Discover and cache the OpenID provider Configuration. Returns null if OIDC is
 *  not usably configured. Cached 60s keyed by issuer+clientId. */
export async function getOidcConfiguration(cfg?: OidcConfig): Promise<client.Configuration | null> {
  const c = cfg ?? getOidcConfig();
  if (!c.enabled || !c.issuerUrl || !c.clientId) return null;
  const key = `${c.issuerUrl}|${c.clientId}`;
  const now = Date.now();
  if (cachedConfig && cachedConfig.key === key && now - cachedConfig.at < 60_000) {
    return cachedConfig.config;
  }
  const config = await client.discovery(new URL(c.issuerUrl), c.clientId, c.clientSecret || undefined);
  cachedConfig = { key, at: now, config };
  return config;
}

/** Replace the user's OIDC-sourced group memberships. Does NOT bump session_version:
 *  this runs during the login callback, immediately before createSession reads the
 *  groups for the JWT snapshot — bumping would invalidate the session being created. */
export function syncOidcGroups(userId: string, appGroupSlugs: string[]): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM user_groups WHERE user_id = ? AND source = 'oidc'").run(userId);
    const findGroup = db.prepare('SELECT id FROM "groups" WHERE slug = ?');
    const insert = db.prepare(
      "INSERT OR IGNORE INTO user_groups (user_id, group_id, source) VALUES (?, ?, 'oidc')"
    );
    for (const slug of appGroupSlugs) {
      const g = findGroup.get(slug) as { id: string } | undefined;
      if (g) insert.run(userId, g.id);
    }
  })();
}
