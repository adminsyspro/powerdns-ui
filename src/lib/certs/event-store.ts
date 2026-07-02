import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import type { CertEvent, CertEventType } from './types';

type Db = Database.Database;

function rowToEvent(r: any): CertEvent {
  return {
    id: r.id,
    certificateId: r.certificate_id,
    ts: r.ts,
    type: r.type,
    status: r.status ?? null,
    actor: r.actor ?? null,
    actorIp: r.actor_ip ?? null,
    message: r.message ?? null,
  };
}

export function appendCertEvent(
  e: {
    certificateId: string;
    type: CertEventType;
    status?: string;
    actor?: string;
    actorIp?: string;
    message?: string;
  },
  db: Db = getDb()
): void {
  db.prepare(
    `INSERT INTO certificate_events (id, certificate_id, type, status, actor, actor_ip, message)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    randomUUID(),
    e.certificateId,
    e.type,
    e.status ?? null,
    e.actor ?? null,
    e.actorIp ?? null,
    e.message ?? null
  );
}

export function listCertEvents(
  certificateId: string,
  limit = 100,
  db: Db = getDb()
): CertEvent[] {
  return db
    .prepare(
      `SELECT id, certificate_id, ts, type, status, actor, actor_ip, message
       FROM certificate_events
       WHERE certificate_id = ?
       ORDER BY ts DESC, rowid DESC
       LIMIT ?`
    )
    .all(certificateId, limit)
    .map(rowToEvent);
}
