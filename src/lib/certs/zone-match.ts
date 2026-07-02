import type Database from 'better-sqlite3';
import { getDb } from '@/lib/cache/db';
import { normalizeUrl } from '@/lib/cache/zones';
import { challengeFqdn } from './dns-txt';

type Db = Database.Database;

export function canonName(name: string): string {
  const t = name.trim().toLowerCase();
  if (!t) return '';
  return t.endsWith('.') ? t : `${t}.`;
}

/** Longest managed zone name (canonical) that is a suffix of fqdn, for this server. */
export function resolveZoneForFqdn(serverUrl: string, fqdn: string, db: Db = getDb()): string | undefined {
  const target = canonName(fqdn);
  const rows = db.prepare(`SELECT name FROM zones WHERE server_url = ?`).all(normalizeUrl(serverUrl)) as Array<{ name: string }>;
  let best: string | undefined;
  for (const { name } of rows) {
    const zone = canonName(name);
    // suffix match on label boundary: target === zone OR target endsWith "." + zone-labels
    if (target === zone || target.endsWith(`.${zone}`)) {
      if (!best || zone.length > best.length) best = zone;
    }
  }
  return best;
}

/** For each SAN, resolve the `_acme-challenge` fqdn and its managed zone. Throws if any SAN is unmanaged. */
export function resolveZonesForSans(
  serverUrl: string, sans: string[], db: Db = getDb()
): { fqdn: string; zone: string }[] {
  return sans.map((san) => {
    const fqdn = challengeFqdn(san);
    const zone = resolveZoneForFqdn(serverUrl, fqdn, db);
    if (!zone) throw new Error(`no managed zone for SAN "${san}" (challenge ${fqdn}) on ${serverUrl}`);
    return { fqdn, zone };
  });
}
