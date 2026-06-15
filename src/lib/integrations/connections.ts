import { getDb } from '@/lib/cache/db';
import { decrypt } from '@/lib/crypto';

export interface StoredConnection {
  id: string;
  name: string;
  url: string;
  apiKey: string;
}

function rowToConn(row: { id: string; name: string; url: string; api_key: string }): StoredConnection {
  return { id: row.id, name: row.name, url: row.url, apiKey: decrypt(row.api_key) };
}

export function getConnectionById(id: string): StoredConnection | undefined {
  const row = getDb()
    .prepare('SELECT id, name, url, api_key FROM server_connections WHERE id = ?')
    .get(id) as { id: string; name: string; url: string; api_key: string } | undefined;
  return row ? rowToConn(row) : undefined;
}

export function connectionExists(id: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM server_connections WHERE id = ?').get(id);
  return row !== undefined;
}
