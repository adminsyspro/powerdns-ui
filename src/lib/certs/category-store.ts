import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';

type Db = Database.Database;

export interface CertificateCategory {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

function rowToCategory(r: any): CertificateCategory {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listCategories(db: Db = getDb()): CertificateCategory[] {
  return db.prepare('SELECT * FROM certificate_categories ORDER BY name').all().map(rowToCategory);
}

export function getCategory(id: string, db: Db = getDb()): CertificateCategory | undefined {
  const r = db.prepare('SELECT * FROM certificate_categories WHERE id = ?').get(id);
  return r ? rowToCategory(r) : undefined;
}

export function getCategoryByName(name: string, db: Db = getDb()): CertificateCategory | undefined {
  const r = db.prepare('SELECT * FROM certificate_categories WHERE name = ?').get(name);
  return r ? rowToCategory(r) : undefined;
}

export function createCategory(
  input: { name: string; description?: string },
  db: Db = getDb(),
): CertificateCategory {
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required');
  const id = randomUUID();
  try {
    db.prepare(
      'INSERT INTO certificate_categories (id, name, description) VALUES (?, ?, ?)',
    ).run(id, name, input.description?.trim() ?? '');
  } catch (e: any) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.message?.includes('UNIQUE')) {
      throw new Error(`Category "${name}" already exists`);
    }
    throw e;
  }
  return getCategory(id, db)!;
}

export function updateCategory(
  id: string,
  patch: { name?: string; description?: string },
  db: Db = getDb(),
): CertificateCategory | undefined {
  const existing = getCategory(id, db);
  if (!existing) return undefined;
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  const description = patch.description !== undefined ? patch.description.trim() : existing.description;
  if (!name) throw new Error('Category name is required');
  try {
    db.prepare(
      'UPDATE certificate_categories SET name = ?, description = ?, updated_at = unixepoch() WHERE id = ?',
    ).run(name, description, id);
  } catch (e: any) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.message?.includes('UNIQUE')) {
      throw new Error(`Category "${name}" already exists`);
    }
    throw e;
  }
  return getCategory(id, db)!;
}

export function deleteCategory(id: string, db: Db = getDb()): boolean {
  const certsUsing = db.prepare(
    'SELECT COUNT(*) AS n FROM certificates WHERE category = (SELECT name FROM certificate_categories WHERE id = ?)',
  ).get(id) as { n: number } | undefined;
  if (certsUsing && certsUsing.n > 0) {
    throw new Error(`Category is used by ${certsUsing.n} certificate(s) and cannot be deleted`);
  }
  return db.prepare('DELETE FROM certificate_categories WHERE id = ?').run(id).changes > 0;
}
