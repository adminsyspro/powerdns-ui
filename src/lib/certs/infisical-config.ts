import { getDb } from '@/lib/cache/db';
import { encrypt, decryptStrict } from '@/lib/crypto';
import type { InfisicalConfig } from './types';

type Db = import('better-sqlite3').Database;

export function isInfisicalEnabled(db: Db = getDb()): boolean {
  const row = db.prepare('SELECT enabled FROM infisical_config WHERE id = 1').get() as
    | { enabled: number }
    | undefined;
  return row?.enabled === 1;
}

export function getInfisicalConfig(db: Db = getDb()): InfisicalConfig | null {
  const row = db.prepare('SELECT * FROM infisical_config WHERE id = 1').get() as any;
  if (!row) return null;
  return {
    enabled: row.enabled === 1,
    siteUrl: row.site_url,
    clientId: row.client_id,
    hasClientSecret: !!row.client_secret_enc,
    projectId: row.project_id,
    environment: row.environment,
    secretBasePath: row.secret_base_path,
  };
}

interface SaveInput {
  enabled: boolean;
  siteUrl: string;
  clientId: string;
  clientSecret?: string;
  projectId: string;
  environment: string;
  secretBasePath: string;
}

export function saveInfisicalConfig(input: SaveInput, db: Db = getDb()): InfisicalConfig {
  const existing = db.prepare('SELECT client_secret_enc FROM infisical_config WHERE id = 1').get() as
    | { client_secret_enc: string }
    | undefined;

  const encSecret = input.clientSecret
    ? encrypt(input.clientSecret)
    : existing?.client_secret_enc ?? '';

  db.prepare(
    `INSERT INTO infisical_config (id, enabled, site_url, client_id, client_secret_enc, project_id, environment, secret_base_path)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled, site_url = excluded.site_url,
       client_id = excluded.client_id, client_secret_enc = excluded.client_secret_enc,
       project_id = excluded.project_id, environment = excluded.environment,
       secret_base_path = excluded.secret_base_path`
  ).run(
    input.enabled ? 1 : 0,
    input.siteUrl,
    input.clientId,
    encSecret,
    input.projectId,
    input.environment,
    input.secretBasePath,
  );

  return getInfisicalConfig(db)!;
}

export function getInfisicalClientSecret(db: Db = getDb()): string | null {
  const row = db.prepare('SELECT client_secret_enc FROM infisical_config WHERE id = 1').get() as
    | { client_secret_enc: string }
    | undefined;
  if (!row || !row.client_secret_enc) return null;
  return decryptStrict(row.client_secret_enc);
}
