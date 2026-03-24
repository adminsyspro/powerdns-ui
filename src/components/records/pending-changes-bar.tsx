'use client';

import { AlertCircle, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePendingChangesStore } from '@/stores';

interface PendingChangesBarProps {
  zoneId: string;
  onOpenValidation: () => void;
}

export function PendingChangesBar({ zoneId, onOpenValidation }: PendingChangesBarProps) {
  const { getZoneChanges, clearZone } = usePendingChangesStore();
  const changes = getZoneChanges(zoneId);

  if (changes.length === 0) return null;

  const adds = changes.filter((c) => c.action === 'ADD').length;
  const edits = changes.filter((c) => c.action === 'EDIT' || c.action === 'TOGGLE').length;
  const deletes = changes.filter((c) => c.action === 'DELETE').length;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-lg">
      <div className="container mx-auto flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          <span className="font-medium">
            {changes.length} pending change{changes.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1.5">
            {adds > 0 && <Badge className="bg-green-600 text-white">{adds} added</Badge>}
            {edits > 0 && <Badge className="bg-amber-600 text-white">{edits} modified</Badge>}
            {deletes > 0 && <Badge className="bg-red-600 text-white">{deletes} deleted</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm('Discard all pending changes?')) clearZone(zoneId);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Discard All
          </Button>
          <Button size="sm" onClick={onOpenValidation}>
            <Check className="mr-2 h-4 w-4" />
            Review & Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
