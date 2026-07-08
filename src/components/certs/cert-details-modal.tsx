'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Trash2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as api from '@/lib/api';
import type { Certificate } from '@/lib/certs/types';

const STATUS_STYLE: Record<string, string> = {
  valid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  expired: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  error: 'bg-destructive/10 text-destructive',
};

const fmtDate = (epochSec: number | null) =>
  epochSec == null ? '—' : new Date(epochSec * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/**
 * Read-only certificate details in a modal, with a delete action. Opened from
 * the zone records-table SSL icon and the zone-level cert icon. `extraAction`
 * (optional) shows a secondary CTA — used to generate the still-missing half of
 * a root/wildcard pair.
 */
export function CertDetailsModal({
  cert, open, onOpenChange, onDeleted, extraAction,
}: {
  cert: Certificate;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted: () => void;
  extraAction?: { label: string; onClick: () => void };
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  // Reset the transient confirm/error state whenever the dialog (re)opens.
  React.useEffect(() => { if (open) { setConfirmDelete(false); setError(''); } }, [open, cert.id]);

  async function onDelete() {
    setError(''); setBusy(true);
    const res = await api.deleteCertificateApi(cert.id);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onOpenChange(false);
    onDeleted();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {cert.name}
            <Badge className={STATUS_STYLE[cert.status] ?? 'bg-muted text-muted-foreground'}>{cert.status}</Badge>
          </DialogTitle>
          <DialogDescription>SSL certificate details.</DialogDescription>
        </DialogHeader>

        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Domains (SAN)</span>
            <div className="flex flex-wrap gap-1.5">
              {cert.sans.map((s) => (
                <span key={s} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-mono">{s}</span>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 rounded-md border p-3">
            <Row label="Issuer">{cert.issuer || '—'}</Row>
            <Row label="Valid from">{fmtDate(cert.notBefore)}</Row>
            <Row label="Expires">{fmtDate(cert.notAfter)}</Row>
            <Row label="Key type">{cert.keyType.toUpperCase()}</Row>
            <Row label="Auto-renew">{cert.autoRenew ? `yes (${cert.renewBeforeDays} days before)` : 'no'}</Row>
            {cert.category && <Row label="Category">{cert.category}</Row>}
          </div>
          {cert.comment && <p className="text-sm text-muted-foreground">{cert.comment}</p>}
          {cert.lastRenewalError && (
            <p className="text-xs text-destructive break-all">Last error: {cert.lastRenewalError}</p>
          )}
          <Link href={`/certificates/${cert.id}`} className="inline-flex items-center gap-1 text-sm text-primary underline">
            Open full page <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Delete this certificate?</span>
                <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {extraAction && (
              <Button variant="secondary" size="sm" onClick={extraAction.onClick} disabled={busy}>{extraAction.label}</Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
