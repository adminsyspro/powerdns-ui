import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/cache/db';
import type { AuthContext } from '@/lib/auth/authz';

type Db = Database.Database;
export type ActivityAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'login_failed' | 'sync' | 'test';
export type ActivityResource = 'zone' | 'record' | 'user' | 'group' | 'setting' | 'connection'
  | 'proxy_env' | 'proxy_key' | 'integration' | 'custom_ns_set' | 'certificate' | 'acme_account' | 'session'
  | 'infisical_config' | 'certificate_category';

export interface ActivityEntry {
  id: string; ts: number; actorId: string | null; actorName: string; actorIp: string | null;
  action: ActivityAction; resourceType: ActivityResource; resourceId: string | null;
  resourceName: string | null; details: string | null;
}

/** Best-effort audit insert — must never throw into the action path. */
export function logActivity(e: {
  actorId?: string | null; actorName: string; actorIp?: string | null;
  action: ActivityAction; resourceType: ActivityResource;
  resourceId?: string | null; resourceName?: string | null; details?: string | null;
}, db?: Db): void {
  try {
    const database = db ?? getDb();
    database.prepare(
      `INSERT INTO activity_log (id, actor_id, actor_name, actor_ip, action, resource_type, resource_id, resource_name, details)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(randomUUID(), e.actorId ?? null, e.actorName, e.actorIp ?? null, e.action,
          e.resourceType, e.resourceId ?? null, e.resourceName ?? null, e.details ?? null);
  } catch (err) {
    console.warn(`[activity] log failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** First hop of x-forwarded-for, else x-real-ip. */
export function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
}

/** Actor fields from an authenticated AuthContext (requireAdmin/requireAuth/…). */
export function actorFromRequest(req: NextRequest, ctx: AuthContext): { actorId: string; actorName: string; actorIp: string | null } {
  return { actorId: ctx.userId, actorName: ctx.username, actorIp: clientIp(req) };
}
/** Actor fields from the middleware-injected identity headers. */
export function actorFromHeaders(req: NextRequest): { actorId: string | null; actorName: string; actorIp: string | null } {
  return { actorId: req.headers.get('x-user-id'), actorName: req.headers.get('x-user-name') || 'unknown', actorIp: clientIp(req) };
}

function rowToEntry(r: any): ActivityEntry {
  return { id: r.id, ts: r.ts, actorId: r.actor_id ?? null, actorName: r.actor_name,
    actorIp: r.actor_ip ?? null, action: r.action, resourceType: r.resource_type,
    resourceId: r.resource_id ?? null, resourceName: r.resource_name ?? null, details: r.details ?? null };
}

export function listActivity(opts: {
  page?: number; pageSize?: number; action?: string; resourceType?: string; actor?: string; search?: string;
} = {}, db: Db = getDb()): { items: ActivityEntry[]; total: number; page: number; pageSize: number; totalPages: number } {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const where: string[] = []; const params: any[] = [];
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  if (opts.resourceType) { where.push('resource_type = ?'); params.push(opts.resourceType); }
  if (opts.actor) { where.push('actor_name = ?'); params.push(opts.actor); }
  if (opts.search) { where.push("(resource_name LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\')");
    const q = `%${opts.search.replace(/[\\%_]/g, (c) => '\\' + c)}%`; params.push(q, q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) n FROM activity_log ${w}`).get(...params) as any).n as number;
  const items = db.prepare(
    `SELECT * FROM activity_log ${w} ORDER BY ts DESC, rowid DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize).map(rowToEntry);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
