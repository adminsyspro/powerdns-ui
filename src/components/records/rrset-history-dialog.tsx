'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { History } from 'lucide-react';
import { ChangeDiffCard } from './change-diff-card';
import type { RRSetHistoryEntry } from '@/types/powerdns';

interface RrsetHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zoneName: string;
  recordName: string;
  recordType: string;
  items: RRSetHistoryEntry[];
  loading: boolean;
  error: boolean;
  totalCount: number;
  hasMore: boolean;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function RrsetHistoryDialog({
  open, onOpenChange, zoneName, recordName, recordType, items, loading, error, totalCount, hasMore,
}: RrsetHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{recordName} · {recordType}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-sm text-destructive">Failed to load change history.</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8">
            <History className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">No recorded changes for this record.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.changesetId} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{item.user}</span>
                  <span>·</span>
                  <span>{fmtDate(item.submittedAt)}</span>
                  {item.reason ? (<><span>·</span><span className="italic">{item.reason}</span></>) : null}
                </div>
                <ChangeDiffCard change={item.change} zoneName={zoneName} />
              </div>
            ))}
            {(hasMore || items.length < totalCount) && (
              <p className="text-center text-xs text-muted-foreground pt-1">
                Showing the {items.length} most recent of {totalCount} changes.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
