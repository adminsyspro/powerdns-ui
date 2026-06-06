import { getDb } from '@/lib/cache/db';

export type MembershipSource = 'manual' | 'ldap' | 'oidc';

export interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  zoneCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  userId: string;
  username: string;
  role: string;
  source: MembershipSource;
}

export interface UserGroupEntry {
  slug: string;
  name: string;
  source: MembershipSource;
}

export const SLUG_RE = /^[a-z0-9-]+$/;
export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 64 && SLUG_RE.test(slug);
}

function toSummary(row: GroupRow): GroupSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    memberCount: groupMemberCount(row.id),
    zoneCount: groupZoneCount(row.slug),
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function listGroups(): GroupSummary[] {
  const rows = getDb().prepare('SELECT * FROM "groups" ORDER BY name').all() as GroupRow[];
  return rows.map(toSummary);
}

export function listGroupsBySlugs(slugs: string[]): GroupSummary[] {
  if (slugs.length === 0) return [];
  const placeholders = slugs.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT * FROM "groups" WHERE slug IN (${placeholders}) ORDER BY name`)
    .all(...slugs) as GroupRow[];
  return rows.map(toSummary);
}

export function getGroupRowBySlug(slug: string): GroupRow | undefined {
  return getDb().prepare('SELECT * FROM "groups" WHERE slug = ?').get(slug) as GroupRow | undefined;
}

export function getGroupBySlug(slug: string): GroupSummary | undefined {
  const row = getGroupRowBySlug(slug);
  return row ? toSummary(row) : undefined;
}

export function createGroup(slug: string, name: string, description: string): GroupSummary {
  const id = crypto.randomUUID();
  getDb()
    .prepare('INSERT INTO "groups" (id, slug, name, description) VALUES (?, ?, ?, ?)')
    .run(id, slug, name, description ?? '');
  return getGroupBySlug(slug)!;
}

export function updateGroup(
  slug: string,
  fields: { name?: string; description?: string }
): GroupSummary | undefined {
  const row = getGroupRowBySlug(slug);
  if (!row) return undefined;
  const name = fields.name ?? row.name;
  const description = fields.description ?? row.description;
  getDb()
    .prepare('UPDATE "groups" SET name = ?, description = ?, updated_at = unixepoch() WHERE slug = ?')
    .run(name, description, slug);
  return getGroupBySlug(slug);
}

/** Deletes the group and (since FKs are not enforced) its user_groups rows.
 *  Returns the number of zones still referencing the slug as their account. */
export function deleteGroup(slug: string): { deleted: boolean; zoneCount: number } {
  const row = getGroupRowBySlug(slug);
  if (!row) return { deleted: false, zoneCount: 0 };
  const zoneCount = groupZoneCount(slug);
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM user_groups WHERE group_id = ?').run(row.id);
    db.prepare('DELETE FROM "groups" WHERE id = ?').run(row.id);
  })();
  return { deleted: true, zoneCount };
}

export function groupMemberCount(groupId: string): number {
  const r = getDb()
    .prepare('SELECT COUNT(DISTINCT user_id) AS c FROM user_groups WHERE group_id = ?')
    .get(groupId) as { c: number };
  return r.c;
}

export function groupZoneCount(slug: string): number {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM zones WHERE account = ?').get(slug) as { c: number };
  return r.c;
}

export function listMembers(groupId: string): GroupMember[] {
  return getDb()
    .prepare(
      `SELECT u.id AS userId, u.username AS username, u.role AS role, ug.source AS source
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
        WHERE ug.group_id = ?
        ORDER BY u.username, ug.source`
    )
    .all(groupId) as GroupMember[];
}

/** Add a manual membership. Idempotent on the (user, group, 'manual') row. */
export function addManualMember(groupId: string, userId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_groups (user_id, group_id, source) VALUES (?, ?, 'manual')`
    )
    .run(userId, groupId);
}

/**
 * Remove a user's MANUAL membership of a group. If the user has only
 * non-manual (ldap/oidc) rows for this group, returns a conflict so the route
 * can 409 — IdP-derived memberships are not hand-removable.
 */
export function removeManualMember(
  groupId: string,
  userId: string
): { removed: boolean; conflictSource?: MembershipSource } {
  const db = getDb();
  const rows = db
    .prepare('SELECT source FROM user_groups WHERE group_id = ? AND user_id = ?')
    .all(groupId, userId) as Array<{ source: MembershipSource }>;
  if (rows.length === 0) return { removed: false };
  const hasManual = rows.some((r) => r.source === 'manual');
  if (!hasManual) {
    const conflictSource = rows[0].source;
    return { removed: false, conflictSource };
  }
  db.prepare(`DELETE FROM user_groups WHERE group_id = ? AND user_id = ? AND source = 'manual'`).run(
    groupId,
    userId
  );
  return { removed: true };
}

export function listUserGroups(userId: string): UserGroupEntry[] {
  return getDb()
    .prepare(
      `SELECT g.slug AS slug, g.name AS name, ug.source AS source
         FROM user_groups ug
         JOIN "groups" g ON g.id = ug.group_id
        WHERE ug.user_id = ?
        ORDER BY g.name, ug.source`
    )
    .all(userId) as UserGroupEntry[];
}

/**
 * Replace the user's MANUAL group memberships with exactly the given slugs.
 * Rows with source 'ldap'/'oidc' are never touched. Unknown slugs are ignored.
 * Returns the slugs that were applied (existing groups only).
 */
export function replaceManualUserGroups(userId: string, slugs: string[]): string[] {
  const db = getDb();
  const applied: string[] = [];
  db.transaction(() => {
    db.prepare(`DELETE FROM user_groups WHERE user_id = ? AND source = 'manual'`).run(userId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO user_groups (user_id, group_id, source) VALUES (?, ?, 'manual')`
    );
    const findGroup = db.prepare('SELECT id FROM "groups" WHERE slug = ?');
    for (const slug of slugs) {
      const g = findGroup.get(slug) as { id: string } | undefined;
      if (g) {
        insert.run(userId, g.id);
        applied.push(slug);
      }
    }
  })();
  return applied;
}

export interface CachedZoneSummary {
  id: string;
  name: string;
  kind: string;
  dnssec: boolean;
  account: string;
}

export function listZonesByAccount(slug: string): CachedZoneSummary[] {
  const rows = getDb()
    .prepare('SELECT id, name, kind, dnssec, account FROM zones WHERE account = ? ORDER BY name')
    .all(slug) as Array<{ id: string; name: string; kind: string; dnssec: number; account: string }>;
  return rows.map((z) => ({ id: z.id, name: z.name, kind: z.kind, dnssec: z.dnssec === 1, account: z.account }));
}
