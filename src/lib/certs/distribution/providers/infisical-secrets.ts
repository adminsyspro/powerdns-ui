import { trimTrailingSlashes, asString } from '../text';
import type { DistributionProvider, ProviderContext, ConnectionConfig, TargetSpec, ResolvedTarget, TestResult } from '../types';

/**
 * Infisical "secrets" provider: writes PRIVKEY / CERT / CHAIN / FULLCHAIN as
 * shared key/value secrets under `<project>/<environment>/<path>`.
 *
 * Connection config: `{ siteUrl, clientId }` + secret = Universal Auth client secret.
 * Target: `{ projectId, environment, path }` — `path` may contain `{category}`
 * and `{name}` placeholders (default `/{category}/{name}`, the historical layout).
 *
 * The isolation model is one Infisical project per consumer, with the consumer
 * identity granted the built-in Viewer role on that project only, so a target
 * usually is `{ projectId: <consumer project>, environment: 'prod', path: '/{name}' }`.
 */

export const SECRET_NAMES = ['PRIVKEY', 'CERT', 'CHAIN', 'FULLCHAIN'] as const;
export const DEFAULT_PATH_TEMPLATE = '/{category}/{name}';

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...args) => fetch(...args);
/** Test seam: replace the HTTP client. */
export function __setInfisicalFetch(f: FetchFn | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
  tokenCache.clear();
}

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const PLACEHOLDER_RE = /\{(name|category)\}/g;

/** Historical folder-name sanitization for cert names/categories (kept byte-identical). */
export function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === 'string' ? v.trim() : '';
}

/** Validate a path template: absolute, segments made of allowed chars and/or placeholders. */
export function normalizePathTemplate(input: string): string {
  const raw = (input || '').trim() || DEFAULT_PATH_TEMPLATE;
  if (!raw.startsWith('/')) throw new Error('path must start with "/"');
  const segs = raw.split('/').filter(Boolean);
  for (const s of segs) {
    const literal = s.replace(PLACEHOLDER_RE, 'x');
    if (/[{}]/.test(literal)) throw new Error(`unknown placeholder in path segment "${s}" (allowed: {name}, {category})`);
    if (!SEGMENT_RE.test(literal)) throw new Error(`invalid path segment "${s}" (letters, digits, "-" and "_" only)`);
  }
  return '/' + segs.join('/');
}

/** Resolve `{name}` / `{category}` for one certificate. Null category → `_default` (historical). */
export function resolvePath(template: string, cert: { name: string; category: string | null }): string {
  const cat = sanitizeFolderName(cert.category?.trim() || '_default');
  const name = sanitizeFolderName(cert.name);
  const segs = template.split('/').filter(Boolean).map((s) =>
    s.replace(PLACEHOLDER_RE, (_m, k: string) => (k === 'name' ? name : cat)),
  );
  return '/' + segs.join('/');
}

// ---------------------------------------------------------------- HTTP helpers

interface Auth { token: string; baseUrl: string }
const tokenCache = new Map<string, { version: number; token: string; expiresAt: number }>();

/** Drop cached tokens (all, or one connection's). */
export function clearInfisicalTokenCache(connectionId?: string): void {
  if (connectionId) tokenCache.delete(connectionId);
  else tokenCache.clear();
}

async function bodyText(res: Response): Promise<string> {
  return res.text().catch(() => '');
}

async function login(ctx: ProviderContext): Promise<Auth> {
  const baseUrl = trimTrailingSlashes(asString(ctx.config.siteUrl));
  const cached = tokenCache.get(ctx.connectionId);
  if (cached?.version === ctx.connectionVersion && Date.now() < cached.expiresAt) {
    return { token: cached.token, baseUrl };
  }
  if (!baseUrl) throw new Error('Infisical site URL not configured');
  if (!ctx.secret) throw new Error('Infisical client secret not configured');
  const res = await fetchImpl(`${baseUrl}/api/v1/auth/universal-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: ctx.config.clientId, clientSecret: ctx.secret }),
  });
  if (!res.ok) throw new Error(`Infisical auth failed (${res.status}): ${await bodyText(res)}`);
  const data = (await res.json()) as { accessToken: string; expiresIn?: number };
  tokenCache.set(ctx.connectionId, {
    version: ctx.connectionVersion,
    token: data.accessToken,
    expiresAt: Date.now() + (data.expiresIn ?? 7200) * 1000 - 60_000,
  });
  return { token: data.accessToken, baseUrl };
}

function headers(auth: Auth): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` };
}

interface Scope { projectId: string; environment: string; path: string }

function scopeOf(target: ResolvedTarget): Scope {
  return { projectId: asString(target.projectId), environment: asString(target.environment), path: asString(target.path) };
}

/** Infisical answers "already exists" with 400 (not 409) on current versions — accept both. */
function isAlreadyExists(status: number, body: string): boolean {
  return status === 409 || (status === 400 && /already exist/i.test(body));
}
function isNotFound(status: number, body: string): boolean {
  return status === 404 || (status === 400 && /not found|does not exist/i.test(body));
}

async function ensureFolder(auth: Auth, scope: Scope, folderPath: string): Promise<void> {
  if (folderPath === '/' || folderPath === '') return;
  const lastSlash = folderPath.lastIndexOf('/');
  const parentPath = lastSlash > 0 ? folderPath.slice(0, lastSlash) : '/';
  await ensureFolder(auth, scope, parentPath);
  const res = await fetchImpl(`${auth.baseUrl}/api/v1/folders`, {
    method: 'POST',
    headers: headers(auth),
    body: JSON.stringify({
      workspaceId: scope.projectId,
      environment: scope.environment,
      name: folderPath.slice(lastSlash + 1),
      path: parentPath,
    }),
  });
  if (res.ok) return;
  const body = await bodyText(res);
  if (isAlreadyExists(res.status, body)) return;
  throw new Error(`Infisical create folder ${folderPath} failed (${res.status}): ${body}`);
}

async function upsertSecret(auth: Auth, scope: Scope, secretName: string, secretValue: string): Promise<void> {
  const url = `${auth.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`;
  const payload = JSON.stringify({
    workspaceId: scope.projectId,
    environment: scope.environment,
    secretPath: scope.path,
    secretName,
    secretValue,
    type: 'shared',
  });
  const created = await fetchImpl(url, { method: 'POST', headers: headers(auth), body: payload });
  if (created.ok) return;
  const createBody = await bodyText(created);
  if (!isAlreadyExists(created.status, createBody)) {
    throw new Error(`Infisical create ${secretName} failed (${created.status}): ${createBody}`);
  }
  const patched = await fetchImpl(url, { method: 'PATCH', headers: headers(auth), body: payload });
  if (!patched.ok) {
    throw new Error(`Infisical update ${secretName} failed (${patched.status}): ${await bodyText(patched)}`);
  }
}

async function deleteSecret(auth: Auth, scope: Scope, secretName: string): Promise<void> {
  const res = await fetchImpl(`${auth.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`, {
    method: 'DELETE',
    headers: headers(auth),
    body: JSON.stringify({
      workspaceId: scope.projectId,
      environment: scope.environment,
      secretPath: scope.path,
      type: 'shared',
    }),
  });
  if (res.ok) return;
  const body = await bodyText(res);
  if (isNotFound(res.status, body)) return;
  throw new Error(`Infisical delete ${secretName} failed (${res.status}): ${body}`);
}

// ---------------------------------------------------------------- provider

export const infisicalSecretsProvider: DistributionProvider = {
  type: 'infisical-secrets',
  label: 'Infisical (secrets)',
  needsSecret: true,

  normalizeConfig(input: unknown): ConnectionConfig {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const siteUrl = trimTrailingSlashes(str(o, 'siteUrl'));
    const clientId = str(o, 'clientId');
    if (!/^https?:\/\/[^\s/]+/i.test(siteUrl)) throw new Error('siteUrl must be an http(s) URL');
    if (!clientId) throw new Error('clientId is required');
    return { siteUrl, clientId };
  },

  normalizeTarget(input: unknown): TargetSpec {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const projectId = str(o, 'projectId');
    const environment = str(o, 'environment');
    if (!projectId) throw new Error('projectId is required');
    if (!environment || !/^[A-Za-z0-9_-]+$/.test(environment)) throw new Error('environment must be an Infisical environment slug');
    return { projectId, environment, path: normalizePathTemplate(str(o, 'path')) };
  },

  resolveTarget(target, cert): ResolvedTarget {
    return {
      projectId: asString(target.projectId),
      environment: asString(target.environment),
      path: resolvePath(asString(target.path) || DEFAULT_PATH_TEMPLATE, cert),
    };
  },

  async publish(ctx, target, material) {
    const auth = await login(ctx);
    const scope = scopeOf(target);
    await ensureFolder(auth, scope, scope.path);
    const values: Record<(typeof SECRET_NAMES)[number], string> = {
      PRIVKEY: material.privkeyPem,
      CERT: material.leafPem,
      CHAIN: material.chainPem,
      // Historical format: leaf + "\n" + chain (consumers compare file contents).
      FULLCHAIN: material.chainPem ? `${material.leafPem}\n${material.chainPem}` : material.leafPem,
    };
    // Sequential on purpose: four small writes, ordered, gentle on the API.
    for (const name of SECRET_NAMES) {
      await upsertSecret(auth, scope, name, values[name]); // NOSONAR — intentional sequential writes
    }
  },

  async unpublish(ctx, target) {
    const auth = await login(ctx);
    const scope = scopeOf(target);
    for (const name of SECRET_NAMES) {
      await deleteSecret(auth, scope, name); // NOSONAR — intentional sequential deletes
    }
  },

  async test(ctx, target): Promise<TestResult> {
    try {
      const auth = await login(ctx);
      if (!target) return { ok: true, detail: 'authenticated' };
      const scope = scopeOf(target);
      const qs = new URLSearchParams({ workspaceId: scope.projectId, environment: scope.environment, secretPath: scope.path });
      const res = await fetchImpl(`${auth.baseUrl}/api/v3/secrets/raw?${qs}`, { headers: { Authorization: `Bearer ${auth.token}` } });
      if (res.ok) return { ok: true, detail: `readable: ${scope.environment}:${scope.path}` };
      const body = await bodyText(res);
      if (isNotFound(res.status, body)) return { ok: true, detail: `folder ${scope.path} does not exist yet (created on first publish)` };
      return { ok: false, error: `API returned ${res.status}: ${body}` };
    } catch (e) {
      clearInfisicalTokenCache(ctx.connectionId);
      return { ok: false, error: (e as Error).message };
    }
  },
};
