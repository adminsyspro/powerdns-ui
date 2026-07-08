'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as api from '@/lib/api';
import { deriveCertName, certNameFormatError, slugifyCertName } from '@/lib/certs/cert-name';
import type { AcmeAccount, Certificate } from '@/lib/certs/types';

type CertType = 'public' | 'internal';
const isPublic = (a: AcmeAccount) => a.caType === 'letsencrypt' || a.caType === 'other';

export function IssueCertForHostDialog({
  seedSans, preselected, zoneName, connectionId, open, onOpenChange, onCreated,
}: {
  seedSans: string[];
  preselected?: string[];
  zoneName: string;
  connectionId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (created?: Certificate) => void;
}) {
  const [accounts, setAccounts] = React.useState<AcmeAccount[]>([]);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [type, setType] = React.useState<CertType>('public');
  const [accountId, setAccountId] = React.useState('');
  const [name, setName] = React.useState('');
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const singleHost = seedSans.length === 1;

  // Reset derived defaults whenever the dialog opens for a (new) seed.
  React.useEffect(() => {
    if (!open) return;
    setError('');
    setName(deriveCertName(singleHost ? seedSans[0] : zoneName));
    setChecked(new Set(preselected ?? seedSans));
    api.fetchAcmeAccounts().then((r) => {
      if (r.error || !r.data) { setLoadFailed(true); setAccounts([]); return; }
      setLoadFailed(false);
      setAccounts(r.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const registered = accounts.filter((a) => a.status === 'registered');
  const publicAccts = registered.filter(isPublic);
  const internalAccts = registered.filter((a) => a.caType === 'step-ca');
  const hasPublic = publicAccts.length > 0;
  const hasInternal = internalAccts.length > 0;
  const typeAccts = type === 'public' ? publicAccts : internalAccts;

  // Pick a sensible default type + account once accounts load.
  React.useEffect(() => {
    if (!open) return;
    const preferred: CertType = hasPublic ? 'public' : hasInternal ? 'internal' : 'public';
    setType(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasPublic, hasInternal]);

  React.useEffect(() => {
    setAccountId(typeAccts.length === 1 ? typeAccts[0].id : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, accounts]);

  const nameError = certNameFormatError(name);
  const selectedSans = seedSans.filter((s) => checked.has(s));
  const noAccounts = registered.length === 0 || loadFailed;

  function toggle(san: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(san); else next.delete(san);
      return next;
    });
  }

  async function onSubmit() {
    setError('');
    if (nameError) { setError(nameError); return; }
    if (!name.trim() || !accountId || selectedSans.length === 0) {
      setError('A name, an ACME account and at least one domain are required.');
      return;
    }
    setBusy(true);
    const res = await api.createCertificateApi({
      name: name.trim(), acmeAccountId: accountId, connectionId, sans: selectedSans,
      keyType: 'ecdsa', autoRenew: true, renewBeforeDays: 30,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onOpenChange(false);
    onCreated(res.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue an SSL certificate</DialogTitle>
          <DialogDescription>ACME DNS-01 issuance for this zone. Issuance starts automatically.</DialogDescription>
        </DialogHeader>
        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {noAccounts ? (
          <p className="text-sm text-muted-foreground">
            No registered ACME account. Create and register one on the{' '}
            <a href="/certificates" className="underline">SSL Certificates</a> page first.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Type — only tabs with a registered account are shown */}
            <div className="space-y-2">
              <Label>Certificate authority</Label>
              <Tabs value={type} onValueChange={(v) => setType(v as CertType)}>
                <TabsList>
                  {hasPublic && <TabsTrigger value="public">Public</TabsTrigger>}
                  {hasInternal && <TabsTrigger value="internal">Internal</TabsTrigger>}
                </TabsList>
              </Tabs>
            </div>

            <div className="space-y-2">
              <Label>ACME account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
                <SelectContent>
                  {typeAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="issue-cert-name">Name (folder on disk)</Label>
              <Input id="issue-cert-name" value={name} onChange={(e) => setName(slugifyCertName(e.target.value))} aria-invalid={!!nameError} />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>

            <div className="space-y-2">
              <Label>Domains</Label>
              {singleHost ? (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">{seedSans[0]}</span>
              ) : (
                <div className="space-y-1">
                  {seedSans.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={checked.has(s)} onCheckedChange={(v) => toggle(s, v === true)} />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={onSubmit} disabled={busy || noAccounts || !!nameError}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
