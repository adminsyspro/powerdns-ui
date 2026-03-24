import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PendingChange, ChangeAction, RRSet } from '@/types/powerdns';
import { generateId } from '@/lib/utils';

function rrsetKey(name: string, type: string): string {
  return `${name}::${type}`;
}

function rrsetEqual(a: RRSet | null, b: RRSet | null): boolean {
  if (!a || !b) return a === b;
  if (a.name !== b.name || a.type !== b.type || a.ttl !== b.ttl) return false;
  if (a.records.length !== b.records.length) return false;
  return a.records.every((r, i) =>
    r.content === b.records[i].content && r.disabled === b.records[i].disabled
  );
}

interface PendingChangesStore {
  changesByZone: Record<string, PendingChange[]>;
  addChange: (zoneId: string, action: ChangeAction, before: RRSet | null, after: RRSet | null) => void;
  removeChange: (zoneId: string, changeId: string) => void;
  clearZone: (zoneId: string) => void;
  clearAll: () => void;
  getZoneChanges: (zoneId: string) => PendingChange[];
  getChangeForRRSet: (zoneId: string, name: string, type: string) => PendingChange | undefined;
  getPendingMap: (zoneId: string) => Map<string, PendingChange>;
  getTotalCount: () => number;
}

export const usePendingChangesStore = create<PendingChangesStore>()(
  persist(
    (set, get) => ({
      changesByZone: {},

      addChange: (zoneId, action, before, after) => {
        set((state) => {
          const changes = [...(state.changesByZone[zoneId] || [])];
          const key = rrsetKey(
            (after || before)!.name,
            (after || before)!.type
          );

          const existingIdx = changes.findIndex((c) => c.rrsetKey === key);

          if (existingIdx >= 0) {
            const existing = changes[existingIdx];
            const originalBefore = existing.before;

            // ADD then DELETE = cancel out
            if (existing.action === 'ADD' && action === 'DELETE') {
              changes.splice(existingIdx, 1);
              return { changesByZone: { ...state.changesByZone, [zoneId]: changes } };
            }

            // Merge: keep original before, update after
            const mergedAfter = action === 'DELETE' ? null : after;

            // If reverted to original state, remove the change
            if (mergedAfter && originalBefore && rrsetEqual(originalBefore, mergedAfter)) {
              changes.splice(existingIdx, 1);
              return { changesByZone: { ...state.changesByZone, [zoneId]: changes } };
            }

            // Determine the effective action
            let effectiveAction: ChangeAction = action;
            if (existing.action === 'ADD' && action !== 'DELETE') {
              effectiveAction = 'ADD'; // keep as ADD
            }

            changes[existingIdx] = {
              ...existing,
              action: effectiveAction,
              after: mergedAfter,
              createdAt: Date.now(),
            };
          } else {
            changes.push({
              id: generateId(),
              zoneId,
              action,
              rrsetKey: key,
              before,
              after,
              createdAt: Date.now(),
            });
          }

          return { changesByZone: { ...state.changesByZone, [zoneId]: changes } };
        });
      },

      removeChange: (zoneId, changeId) => {
        set((state) => ({
          changesByZone: {
            ...state.changesByZone,
            [zoneId]: (state.changesByZone[zoneId] || []).filter((c) => c.id !== changeId),
          },
        }));
      },

      clearZone: (zoneId) => {
        set((state) => {
          const { [zoneId]: _, ...rest } = state.changesByZone;
          return { changesByZone: rest };
        });
      },

      clearAll: () => set({ changesByZone: {} }),

      getZoneChanges: (zoneId) => get().changesByZone[zoneId] || [],

      getChangeForRRSet: (zoneId, name, type) => {
        const changes = get().changesByZone[zoneId] || [];
        return changes.find((c) => c.rrsetKey === rrsetKey(name, type));
      },

      getPendingMap: (zoneId) => {
        const changes = get().changesByZone[zoneId] || [];
        const map = new Map<string, PendingChange>();
        for (const c of changes) {
          map.set(c.rrsetKey, c);
        }
        return map;
      },

      getTotalCount: () => {
        const { changesByZone } = get();
        return Object.values(changesByZone).reduce((sum, arr) => sum + arr.length, 0);
      },
    }),
    { name: 'pdns-pending-changes' }
  )
);
