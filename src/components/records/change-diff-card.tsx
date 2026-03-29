'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Undo2 } from 'lucide-react';
import type { PendingChange } from '@/types/powerdns';
import { getRecordTypeColor } from '@/lib/utils';

interface ChangeDiffCardProps {
  change: PendingChange;
  zoneName: string;
  onRemove?: () => void;
}

function formatName(name: string, zoneName: string): string {
  if (name === zoneName || name === `${zoneName}.`) return '@';
  return name.replaceAll(`.${zoneName}`, '').replaceAll(zoneName, '').replace(/\.$/, '') || '@';
}

const ACTION_STYLES = {
  ADD: { label: 'Added', badge: 'bg-green-600 text-white', bg: 'border-l-green-500' },
  EDIT: { label: 'Modified', badge: 'bg-amber-600 text-white', bg: 'border-l-amber-500' },
  DELETE: { label: 'Deleted', badge: 'bg-red-600 text-white', bg: 'border-l-red-500' },
  TOGGLE: { label: 'Toggled', badge: 'bg-blue-600 text-white', bg: 'border-l-blue-500' },
};

export function ChangeDiffCard({ change, zoneName, onRemove }: ChangeDiffCardProps) {
  const style = ACTION_STYLES[change.action];
  const rrset = change.after || change.before;
  if (!rrset) return null;

  return (
    <div className={`border-l-4 ${style.bg} rounded-md border bg-card p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge className={style.badge}>{style.label}</Badge>
          <Badge className={getRecordTypeColor(rrset.type)} variant="outline">{rrset.type}</Badge>
          <span className="font-mono text-sm font-medium">{formatName(rrset.name, zoneName)}</span>
        </div>
        {onRemove && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1 text-sm">
        {/* Before */}
        {change.before && change.action !== 'ADD' && (
          <div className="flex gap-2">
            <span className="text-red-600 font-mono text-xs w-4 flex-shrink-0">-</span>
            <div className="bg-red-50 dark:bg-red-950/30 rounded px-2 py-1 flex-1 font-mono text-xs">
              <span className="text-muted-foreground">TTL:{change.before.ttl} </span>
              {change.before.records.map((r, i) => (
                <span key={i}>
                  {r.content}
                  {r.disabled && <span className="text-red-400 ml-1">(disabled)</span>}
                  {i < change.before!.records.length - 1 && ' | '}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* After */}
        {change.after && change.action !== 'DELETE' && (
          <div className="flex gap-2">
            <span className="text-green-600 font-mono text-xs w-4 flex-shrink-0">+</span>
            <div className="bg-green-50 dark:bg-green-950/30 rounded px-2 py-1 flex-1 font-mono text-xs">
              <span className="text-muted-foreground">TTL:{change.after.ttl} </span>
              {change.after.records.map((r, i) => (
                <span key={i}>
                  {r.content}
                  {r.disabled && <span className="text-amber-500 ml-1">(disabled)</span>}
                  {i < change.after!.records.length - 1 && ' | '}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
