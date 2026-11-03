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
  change?: PendingChange;
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
        result.push({ rrset, pendingAction: 'DELETE', changeId: change.id, change });
      } else {
        // EDIT or TOGGLE: show the "after" state
        result.push({ rrset: change.after!, pendingAction: change.action, changeId: change.id, change });
      }
    } else {
      result.push({ rrset });
    }
  }

  // Append ADDs that aren't in existing records
  for (const change of changes) {
    if (change.action === 'ADD' && !processedKeys.has(change.rrsetKey)) {
      result.push({ rrset: change.after!, pendingAction: 'ADD', changeId: change.id, change });
    }
  }

  return result;
}

/**
 * Pending change for adding one value to an RRSet (the record form in "add"
 * mode). The new value is merged into the RRSet's current state — pending
 * change first, server state otherwise — replacing any identical value.
 */
export function buildAddRecordChange(
  pendingChange: PendingChange | undefined,
  originalRRSet: RRSet | undefined,
  newRRSet: RRSet,
  comment?: string
): { action: ChangeAction; before: RRSet | null; after: RRSet } {
  // A queued whole-RRSet DELETE (after = null): the old values are gone, so the
  // RRSet restarts from the new value alone. Falling back to the server state
  // here would resurrect the deleted values. EDIT (not ADD) so that deleting
  // the new value again still deletes the original RRSet.
  if (pendingChange && !pendingChange.after) {
    return { action: 'EDIT', before: pendingChange.before, after: newRRSet };
  }
  const baseRRSet = pendingChange?.after || originalRRSet;
  if (!baseRRSet) return { action: 'ADD', before: null, after: newRRSet };

  const newRecord = newRRSet.records[0];
  const comments = comment
    ? [...(baseRRSet.comments || []), ...(newRRSet.comments || [])]
    : baseRRSet.comments;
  return {
    action: pendingChange?.action === 'ADD' ? 'ADD' : 'EDIT',
    before: pendingChange?.before || originalRRSet || null,
    after: {
      ...baseRRSet,
      records: [...baseRRSet.records.filter((r) => r.content !== newRecord.content), newRecord],
      comments,
    },
  };
}

/** Apply a row edit to a complete RRset. */
export function buildEditRecordChange(base: RRSet, originalContent: string, edited: RRSet): RRSet {
  if (!base.records.some((r) => r.content === originalContent)) throw new Error('The record no longer exists. Refresh the zone and try again.');
  return { ...edited, records: [
    ...base.records.filter((r) => r.content !== originalContent && r.content !== edited.records[0].content),
    edited.records[0],
  ] };
}

/** Refuse to overwrite RRsets that changed since they were staged. */
export function findStaleChanges(changes: PendingChange[], current: RRSet[]): PendingChange[] {
  const equal = (a: RRSet | null, b: RRSet | null): boolean => {
    if (!a || !b) return a === b;
    if (a.name !== b.name || a.type !== b.type || a.ttl !== b.ttl || a.records.length !== b.records.length) return false;
    const values = (r: RRSet) => r.records.map((v) => JSON.stringify([v.content, v.disabled])).sort();
    return JSON.stringify(values(a)) === JSON.stringify(values(b)) &&
      JSON.stringify(a.comments || []) === JSON.stringify(b.comments || []);
  };
  return changes.filter((change) => {
    const target = change.before || change.after;
    if (!target || (change.before && change.after && (change.before.name !== change.after.name || change.before.type !== change.after.type))) return true;
    const server = current.find((r) => r.name === target.name && r.type === target.type) || null;
    return !equal(change.before, server);
  });
}
