'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ChangeDiffCard } from './change-diff-card';
import { useAuthStore, usePendingChangesStore } from '@/stores';
import { changesToRRSets } from '@/lib/pending-changes-utils';
import * as api from '@/lib/api';
import { generateId } from '@/lib/utils';
import type { ChangesetSubmission } from '@/types/powerdns';

interface ValidationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zoneId: string;
  zoneName: string;
  onSuccess: () => void;
}

export function ValidationModal({ open, onOpenChange, zoneId, zoneName, onSuccess }: ValidationModalProps) {
  const { user } = useAuthStore();
  const { getZoneChanges, removeChange, clearZone } = usePendingChangesStore();
  const changes = getZoneChanges(zoneId);
  const [reason, setReason] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setIsSubmitting(true);
    setError(null);

    const rrsets = changesToRRSets(changes);
    const result = await api.updateZoneRecords(zoneId, rrsets);

    const submission: ChangesetSubmission = {
      id: generateId(),
      zoneId,
      zoneName,
      changes,
      reason: reason.trim(),
      user: user?.username || 'unknown',
      submittedAt: Date.now(),
      status: result.error ? 'error' : 'success',
      errorMessage: result.error || undefined,
    };

    // Save to history regardless of success/failure
    await api.saveChangeHistory(submission);

    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    clearZone(zoneId);
    setReason('');
    setIsSubmitting(false);
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] !flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Review Changes</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {zoneName}
            <Badge variant="outline">{changes.length} change{changes.length !== 1 ? 's' : ''}</Badge>
          </DialogDescription>
        </DialogHeader>

        {/* Changes list */}
        <div className="min-h-0 flex-1 -mx-6 overflow-y-auto px-6 pr-4">
          <div className="space-y-2">
            {changes.map((change) => (
              <ChangeDiffCard
                key={change.id}
                change={change}
                zoneName={zoneName}
                onRemove={() => removeChange(zoneId, change.id)}
              />
            ))}
          </div>
        </div>

        {/* Reason */}
        <div className="shrink-0 space-y-2 pt-2 border-t">
          <Label htmlFor="reason">Reason for changes *</Label>
          <Textarea
            id="reason"
            placeholder="Describe the reason for these changes..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        {error && (
          <div className="shrink-0 p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200 text-sm">
            {error}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !reason.trim() || changes.length === 0}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Applying...</>
            ) : (
              `Apply ${changes.length} Change${changes.length !== 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
