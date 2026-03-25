import { getDb } from '@/lib/cache/db';
import type {
  ProxyEnvironmentRow,
  ProxyZonePermissionRow,
  ProxyRecordRuleRow,
  ProxyZonePermission,
} from '@/types/proxy';
import type { RRSet } from '@/types/powerdns';

/**
 * Find an active environment by its token SHA-512 hash.
 */
export function getEnvironmentByTokenHash(tokenHash: string): ProxyEnvironmentRow | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM proxy_environments WHERE token_sha512 = ? AND active = 1'
  ).get(tokenHash) as ProxyEnvironmentRow | undefined;
  return row ?? null;
}

/**
 * Get all zone permissions (with record rules) for an environment.
 */
export function getZonePermissions(environmentId: string): ProxyZonePermission[] {
  const db = getDb();

  const zoneRows = db.prepare(
    'SELECT * FROM proxy_zone_permissions WHERE environment_id = ?'
  ).all(environmentId) as ProxyZonePermissionRow[];

  return zoneRows.map((zone) => {
    const ruleRows = db.prepare(
      'SELECT * FROM proxy_record_rules WHERE zone_perm_id = ?'
    ).all(zone.id) as ProxyRecordRuleRow[];

    return {
      id: zone.id,
      environmentId: zone.environment_id,
      zoneName: zone.zone_name,
      acmeEnabled: zone.acme_enabled === 1,
      recordRules: ruleRows.map((r) => ({
        id: r.id,
        ruleType: r.rule_type,
        pattern: r.pattern,
      })),
    };
  });
}

/**
 * Check if a zone is allowed for an environment.
 */
export function isZoneAllowed(environmentId: string, zoneName: string): ProxyZonePermission | null {
  const db = getDb();
  // Normalize: PowerDNS zone IDs end with a dot, zone_name in DB may or may not
  const normalized = zoneName.replace(/\.$/, '');

  const zone = db.prepare(
    `SELECT * FROM proxy_zone_permissions
     WHERE environment_id = ? AND (zone_name = ? OR zone_name = ?)`
  ).get(environmentId, normalized, normalized + '.') as ProxyZonePermissionRow | undefined;

  if (!zone) return null;

  const ruleRows = db.prepare(
    'SELECT * FROM proxy_record_rules WHERE zone_perm_id = ?'
  ).all(zone.id) as ProxyRecordRuleRow[];

  return {
    id: zone.id,
    environmentId: zone.environment_id,
    zoneName: zone.zone_name,
    acmeEnabled: zone.acme_enabled === 1,
    recordRules: ruleRows.map((r) => ({
      id: r.id,
      ruleType: r.rule_type,
      pattern: r.pattern,
    })),
  };
}

/**
 * Filter a list of zones to only those the environment has access to.
 */
export function filterZones<T extends { name?: string; id?: string }>(
  environmentId: string,
  zones: T[]
): T[] {
  const permissions = getZonePermissions(environmentId);
  const allowedNames = new Set(
    permissions.map((p) => p.zoneName.replace(/\.$/, ''))
  );

  return zones.filter((z) => {
    const name = (z.name || z.id || '').replace(/\.$/, '');
    return allowedNames.has(name);
  });
}

/**
 * Check if a specific record is allowed by a zone permission.
 */
export function isRecordAllowed(
  zonePerm: ProxyZonePermission,
  recordName: string,
  recordType?: string
): boolean {
  // No record rules = all records allowed
  if (zonePerm.recordRules.length === 0 && !zonePerm.acmeEnabled) {
    return true;
  }

  // If only acme is enabled and no other rules, only ACME records allowed
  if (zonePerm.recordRules.length === 0 && zonePerm.acmeEnabled) {
    return isAcmeRecord(recordName, recordType);
  }

  // Check ACME first
  if (zonePerm.acmeEnabled && isAcmeRecord(recordName, recordType)) {
    return true;
  }

  // Check exact matches
  for (const rule of zonePerm.recordRules) {
    if (rule.ruleType === 'exact') {
      const normalizedPattern = rule.pattern.replace(/\.$/, '');
      const normalizedRecord = recordName.replace(/\.$/, '');
      if (normalizedPattern === normalizedRecord) return true;
    }
  }

  // Check regex matches
  for (const rule of zonePerm.recordRules) {
    if (rule.ruleType === 'regex') {
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(recordName) || regex.test(recordName.replace(/\.$/, ''))) return true;
      } catch {
        // Invalid regex — skip
      }
    }
  }

  return false;
}

function isAcmeRecord(recordName: string, recordType?: string): boolean {
  const normalized = recordName.replace(/\.$/, '');
  const isAcmeName = normalized.startsWith('_acme-challenge.');
  // If recordType is provided, must be TXT; otherwise allow (we may not know the type)
  if (recordType && recordType !== 'TXT') return false;
  return isAcmeName;
}

/**
 * Filter RRSets to only those the environment is allowed to see.
 */
export function filterRRSets(zonePerm: ProxyZonePermission, rrsets: RRSet[]): RRSet[] {
  // No rules and no acme = full access
  if (zonePerm.recordRules.length === 0 && !zonePerm.acmeEnabled) {
    return rrsets;
  }

  return rrsets.filter((rrset) => isRecordAllowed(zonePerm, rrset.name, rrset.type));
}

/**
 * Validate that ALL rrsets in a PATCH payload are allowed.
 * Returns denied record names if any fail.
 */
export function validatePatchPayload(
  zonePerm: ProxyZonePermission,
  rrsets: RRSet[]
): { allowed: boolean; denied: string[] } {
  // No rules and no acme = full access
  if (zonePerm.recordRules.length === 0 && !zonePerm.acmeEnabled) {
    return { allowed: true, denied: [] };
  }

  const denied: string[] = [];
  for (const rrset of rrsets) {
    if (!isRecordAllowed(zonePerm, rrset.name, rrset.type)) {
      denied.push(`${rrset.name} (${rrset.type})`);
    }
  }

  return { allowed: denied.length === 0, denied };
}
