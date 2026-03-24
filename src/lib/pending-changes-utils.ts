import type { RRSet, PendingChange, ChangeAction } from '@/types/powerdns';

/**
 * Convert pending changes to PowerDNS RRSet patch format.
 * All changes are batched into a single PATCH request.
 */
export function changesToRRSets(changes: PendingChange[]): RRSet[] {
  return changes.map((change) => {
    if (change.action === 'DELETE') {
      return {
        name: change.before!.name,
        type: change.before!.type,
        ttl: change.before!.ttl,
        changetype: 'DELETE' as const,
        records: [],
      };
    }
    // ADD, EDIT, TOGGLE all use REPLACE
    return {
      ...change.after!,
      changetype: 'REPLACE' as const,
    };
  });
}

export interface MergedRecord {
  rrset: RRSet;
  pendingAction?: ChangeAction;
  changeId?: string;
}

/**
 * Merge server records with pending changes for display.
 * - EDITs/TOGGLEs: replace matching rrsets with the pending "after" state
 * - DELETEs: keep the record but mark as deleted
 * - ADDs: append at the end
 */
export function mergeRecordsWithPending(
  rrsets: RRSet[],
  changes: PendingChange[]
): MergedRecord[] {
  const changeMap = new Map<string, PendingChange>();
  for (const c of changes) {
    changeMap.set(c.rrsetKey, c);
  }

  const result: MergedRecord[] = [];
  const processedKeys = new Set<string>();

  // Process existing records
  for (const rrset of rrsets) {
    const key = `${rrset.name}::${rrset.type}`;
    const change = changeMap.get(key);

    if (change) {
      processedKeys.add(key);
      if (change.action === 'DELETE') {
        result.push({ rrset, pendingAction: 'DELETE', changeId: change.id });
      } else {
        // EDIT or TOGGLE: show the "after" state
        result.push({ rrset: change.after!, pendingAction: change.action, changeId: change.id });
      }
    } else {
      result.push({ rrset });
    }
  }

  // Append ADDs that aren't in existing records
  for (const change of changes) {
    if (change.action === 'ADD' && !processedKeys.has(change.rrsetKey)) {
      result.push({ rrset: change.after!, pendingAction: 'ADD', changeId: change.id });
    }
  }

  return result;
}
