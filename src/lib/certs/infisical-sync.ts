import { getDb } from '@/lib/cache/db';
import { isInfisicalEnabled, getInfisicalClientSecret } from './infisical-config';
import { getCertificate, getCertificateBundle, getCertificatePrivateKey, listCertificates, setCertificateInfisicalSynced } from './cert-store';
import { appendCertEvent } from './event-store';
import type { SyncSummary } from './types';

let cachedToken: { token: string; baseUrl: string; projectId: string; environment: string; basePath: string; expiresAt: number } | null = null;

/** Invalidate the cached Infisical access token (e.g. after config changes). */
export function clearTokenCache(): void {
  cachedToken = null;
}

function getConfigRow(db = getDb()) {
  const row = db.prepare('SELECT * FROM infisical_config WHERE id = 1').get() as any;
  if (!row || !row.enabled) throw new Error('Infisical is not configured or disabled');
  return row;
}

async function getAccessToken(db = getDb()): Promise<typeof cachedToken & {}> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken;

  const row = getConfigRow(db);
  const clientSecret = getInfisicalClientSecret(db);
  if (!clientSecret) throw new Error('Infisical client secret not configured');

  const res = await fetch(`${row.site_url}/api/v1/auth/universal-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: row.client_id, clientSecret }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Infisical auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.accessToken,
    baseUrl: row.site_url,
    projectId: row.project_id,
    environment: row.environment,
    basePath: row.secret_base_path || '/ssl',
    expiresAt: Date.now() + (data.expiresIn ?? 7200) * 1000 - 60_000,
  };
  return cachedToken;
}

function buildSecretPath(basePath: string, category: string | null, certName: string): string {
  const cat = category?.trim() || '_default';
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}/${cat}/${certName}`;
}

const ensuredFolders = new Set<string>();

async function ensureFolder(
  auth: NonNullable<typeof cachedToken>,
  folderPath: string,
): Promise<void> {
  const key = `${auth.projectId}:${auth.environment}:${folderPath}`;
  if (ensuredFolders.has(key)) return;

  // Ensure parent exists first (recursive)
  const lastSlash = folderPath.lastIndexOf('/');
  if (lastSlash > 0) {
    await ensureFolder(auth, folderPath.slice(0, lastSlash));
  }

  const folderName = folderPath.slice(lastSlash + 1);
  const parentPath = lastSlash > 0 ? folderPath.slice(0, lastSlash) : '/';

  const res = await fetch(`${auth.baseUrl}/api/v1/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      workspaceId: auth.projectId,
      environment: auth.environment,
      name: folderName,
      path: parentPath,
    }),
  });
  // 400 = folder already exists — that's fine
  if (!res.ok && res.status !== 400 && res.status !== 409) {
    const body = await res.text().catch(() => '');
    throw new Error(`Infisical create folder ${folderPath} failed (${res.status}): ${body}`);
  }
  ensuredFolders.add(key);
}

async function upsertSecret(
  auth: NonNullable<typeof cachedToken>,
  category: string | null,
  certName: string,
  secretName: string,
  secretValue: string,
): Promise<void> {
  const secretPath = buildSecretPath(auth.basePath, category, certName);
  const payload = {
    workspaceId: auth.projectId,
    environment: auth.environment,
    secretPath,
    secretName,
    secretValue,
    type: 'shared' as const,
  };

  const createRes = await fetch(`${auth.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify(payload),
  });

  if (createRes.status === 409) {
    const patchRes = await fetch(`${auth.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(payload),
    });
    if (!patchRes.ok) {
      const body = await patchRes.text().catch(() => '');
      throw new Error(`Infisical update ${secretName} failed (${patchRes.status}): ${body}`);
    }
    return;
  }

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    throw new Error(`Infisical create ${secretName} failed (${createRes.status}): ${body}`);
  }
}

async function deleteSecret(
  auth: NonNullable<typeof cachedToken>,
  category: string | null,
  certName: string,
  secretName: string,
): Promise<void> {
  const res = await fetch(`${auth.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      workspaceId: auth.projectId,
      environment: auth.environment,
      secretPath: buildSecretPath(auth.basePath, category, certName),
      type: 'shared',
    }),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Infisical delete ${secretName} failed (${res.status}): ${body}`);
  }
}

const SECRET_NAMES = ['PRIVKEY', 'CERT', 'CHAIN', 'FULLCHAIN'] as const;

export async function syncCertToInfisical(certId: string): Promise<void> {
  const db = getDb();
  const cert = getCertificate(certId, db);
  if (!cert) throw new Error(`Certificate ${certId} not found`);

  const bundle = getCertificateBundle(certId, db);
  if (!bundle) throw new Error(`Certificate ${certId} has no issued PEM data`);

  const privkey = getCertificatePrivateKey(certId, db);
  if (!privkey) throw new Error(`Certificate ${certId} has no private key`);

  const fullchain = bundle.chainPem
    ? `${bundle.certPem}\n${bundle.chainPem}`
    : bundle.certPem;

  const auth = await getAccessToken(db);
  const secrets: Record<string, string> = {
    PRIVKEY: privkey,
    CERT: bundle.certPem,
    CHAIN: bundle.chainPem ?? '',
    FULLCHAIN: fullchain,
  };

  const secretPath = buildSecretPath(auth.basePath, cert.category, cert.name);
  await ensureFolder(auth, secretPath);

  for (const [name, value] of Object.entries(secrets)) {
    await upsertSecret(auth, cert.category, cert.name, name, value);
  }

  setCertificateInfisicalSynced(certId, db);
  appendCertEvent({ certificateId: certId, type: 'infisical_synced', status: 'ok', message: 'synced to Infisical' }, db);
}

export async function syncAllCertsToInfisical(): Promise<SyncSummary> {
  const db = getDb();
  const certs = listCertificates(db).filter((c) => c.hasCert);
  const summary: SyncSummary = { synced: 0, failed: 0, errors: [] };

  for (const cert of certs) {
    try {
      await syncCertToInfisical(cert.id);
      summary.synced++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ certId: cert.id, name: cert.name, error: (err as Error).message });
    }
  }
  return summary;
}

export async function deleteCertFromInfisical(certName: string, category: string | null): Promise<void> {
  const db = getDb();
  if (!isInfisicalEnabled(db)) return;
  const auth = await getAccessToken(db);
  for (const name of SECRET_NAMES) {
    await deleteSecret(auth, category, certName, name);
  }
}

export async function testInfisicalConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getDb();
    const auth = await getAccessToken(db);
    const res = await fetch(`${auth.baseUrl}/api/v3/secrets/raw?workspaceId=${encodeURIComponent(auth.projectId)}&environment=${encodeURIComponent(auth.environment)}&secretPath=${encodeURIComponent(auth.basePath)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `API returned ${res.status}: ${body}` };
    }
    cachedToken = null;
    return { ok: true };
  } catch (err) {
    cachedToken = null;
    return { ok: false, error: (err as Error).message };
  }
}
