import type Database from 'better-sqlite3';
import { hashPasswordSync } from './password';

/**
 * Create the default admin account if no users exist yet.
 * Uses scryptSync since this runs once at startup.
 */
export function seedDefaultAdmin(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (count.cnt > 0) return;

  const id = crypto.randomUUID();
  const passwordHash = hashPasswordSync('admin');

  db.prepare(
    `INSERT INTO users (id, username, email, firstname, lastname, role, active, password_hash, auth_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'admin', 'admin@localhost', 'Admin', 'User', 'Administrator', 1, passwordHash, 'local');
}
