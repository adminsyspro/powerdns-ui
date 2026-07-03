'use client';

import * as React from 'react';
import { Loader2, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as api from '@/lib/api';
import type { AcmeAccount } from '@/lib/certs/types';
import type { ServerConnection, ZoneListItem } from '@/types/powerdns';

const SAN_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME']);
const stripDot = (s: string) => s.replace(/\.$/, '');

export function CreateCertDialog({ accounts, onCreated, trigger }: { accounts: AcmeAccount[]; onCreated: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [connections, setConnections] = React.useState<ServerConnection[]>([]);
  const [name, setName] = React.useState('');
  const [sans, setSans] = React.useState<string[]>([]);
  const [accountId, setAccountId] = React.useState('');
  const [connectionId, setConnectionId] = React.useState('');
  const [keyType, setKeyType] = React.useState<'ecdsa' | 'rsa'>('ecdsa');
  const [autoRenew, setAutoRenew] = React.useState(true);
  const [renewBeforeDays, setRenewBeforeDays] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  // Zone builder state
  const [zoneQuery, setZoneQuery] = React.useState('');
  const [zoneResults, setZoneResults] = React.useState<ZoneListItem[]>([]);
  const [selectedZone, setSelectedZone] = React.useState<ZoneListItem | null>(null);
  const [zoneRecordNames, setZoneRecordNames] = React.useState<string[]>([]);
  const [recordsLoading, setRecordsLoading] = React.useState(false);
  const [manual, setManual] = React.useState('');
  const zoneReqRef = React.useRef(0);
  const searchReqRef = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    api.fetchConnections().then((r) => {
      if (r.error) { setError(r.error); return; }
      setConnections(r.data ?? []);
    });
  }, [open]);

  // Debounced zone typeahead, scoped to the selected connection.
  React.useEffect(() => {
    if (!open || !connectionId || zoneQuery.trim().length < 1) { setZoneResults([]); return; }
    const q = zoneQuery.trim();
    const t = setTimeout(async () => {
      const token = ++searchReqRef.current;
      const r = await api.fetchZonesForConnection(connectionId, q);
      if (searchReqRef.current !== token) return;
      if (!r.error) setZoneResults(r.data?.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [zoneQuery, connectionId, open]);

  function reset() {
    setName(''); setSans([]); setAccountId(''); setConnectionId('');
    setKeyType('ecdsa'); setAutoRenew(true); setRenewBeforeDays(30); setError('');
    setZoneQuery(''); setZoneResults([]); setSelectedZone(null); setZoneRecordNames([]); setManual('');
  }

  function onConnectionChange(v: string) {
    setConnectionId(v);
    setSelectedZone(null); setZoneRecordNames([]); setZoneQuery(''); setZoneResults([]);
    zoneReqRef.current++; searchReqRef.current++;
  }

  function addSan(v: string) {
    const s = v.trim();
    if (!s) return;
    setSans((prev) => (prev.some((x) => x.toLowerCase() === s.toLowerCase()) ? prev : [...prev, s]));
  }
  function removeSan(v: string) { setSans((prev) => prev.filter((x) => x !== v)); }
  function toggleSan(v: string, checked: boolean) { checked ? addSan(v) : removeSan(v); }

  async function selectZone(z: ZoneListItem) {
    const token = ++zoneReqRef.current;
    setSelectedZone(z); setZoneResults([]); setZoneQuery(''); setZoneRecordNames([]); setRecordsLoading(true);
    const r = await api.fetchZoneForConnection(connectionId, z.id);
    if (zoneReqRef.current !== token) return;
    setRecordsLoading(false);
    if (r.error || !r.data) { setError(r.error ?? 'failed to load zone'); return; }
    const names = new Set<string>();
    for (const rr of r.data.rrsets ?? []) {
      if (SAN_RECORD_TYPES.has(rr.type)) names.add(stripDot(rr.name));
    }
    setZoneRecordNames([...names].sort());
  }

  const apex = selectedZone ? stripDot(selectedZone.name) : '';
  const wildcard = apex ? `*.${apex}` : '';

  async function onSubmit() {
    setError('');
    if (!name.trim() || sans.length === 0 || !accountId || !connectionId) {
      setError('Name, at least one SAN, an account and a connection are required.');
      return;
    }
    if (!Number.isInteger(renewBeforeDays) || renewBeforeDays < 1 || renewBeforeDays > 90) {
      setError('The number of days must be between 1 and 90.');
      return;
    }
    setBusy(true);
    const res = await api.createCertificateApi({
      name: name.trim(), acmeAccountId: accountId, connectionId, sans, keyType, autoRenew, renewBeforeDays,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setOpen(false); reset(); onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="h-6 w-6" title="New certificate" aria-label="New certificate">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New certificate</DialogTitle>
          <DialogDescription>ACME DNS-01 issuance. SANs are canonicalized server-side.</DialogDescription>
        </DialogHeader>
        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cert-name">Name (identifier / folder on disk)</Label>
            <Input id="cert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="web-prod" />
          </div>

          <div className="space-y-2">
            <Label>PowerDNS connection</Label>
            <Select value={connectionId} onValueChange={onConnectionChange}>
              <SelectTrigger><SelectValue placeholder="Choose a connection" /></SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/powerdns-logo.png" alt="" className="h-4 w-4 shrink-0 object-cover object-left" />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* SAN builder */}
          <div className="space-y-2">
            <Label>Domains / SAN</Label>
            {!connectionId ? (
              <p className="text-sm text-muted-foreground">Choose a PowerDNS connection first.</p>
            ) : (
              <div className="space-y-2 rounded-md border p-3">
                {/* zone typeahead */}
                <Input
                  value={zoneQuery}
                  onChange={(e) => setZoneQuery(e.target.value)}
                  placeholder="Search a zone…"
                />
                {zoneResults.length > 0 && (
                  <div className="max-h-40 overflow-auto rounded-md border">
                    {zoneResults.map((z) => (
                      <button
                        key={z.id}
                        type="button"
                        onClick={() => selectZone(z)}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        {stripDot(z.name)}
                      </button>
                    ))}
                  </div>
                )}

                {selectedZone && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{apex}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => addSan(apex)}>+ {apex}</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => addSan(wildcard)}>+ {wildcard}</Button>
                    </div>
                    {recordsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading records…</div>
                    ) : zoneRecordNames.length > 0 ? (
                      <div className="max-h-40 space-y-1 overflow-auto">
                        {zoneRecordNames.map((n) => (
                          <label key={n} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={sans.some((x) => x.toLowerCase() === n.toLowerCase())} onCheckedChange={(v) => toggleSan(n, v === true)} />
                            <span>{n}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No A/AAAA/CNAME records in this zone.</p>
                    )}
                  </div>
                )}

                {/* manual add */}
                <div className="flex gap-2">
                  <Input
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSan(manual); setManual(''); } }}
                    placeholder="Add a SAN manually (e.g. *.other-zone.com)"
                  />
                  <Button type="button" variant="secondary" onClick={() => { addSan(manual); setManual(''); }}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* selected SAN chips */}
            {sans.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sans.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                    {s}
                    <button type="button" onClick={() => removeSan(s)} aria-label={`remove ${s}`} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No SAN selected.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>ACME account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.status !== 'registered' ? ` (${a.status})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No ACME account. Create one in the &quot;ACME Accounts&quot; tab before creating a certificate.
              </p>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>Key type</Label>
              <Select value={keyType} onValueChange={(v) => setKeyType(v as 'ecdsa' | 'rsa')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ecdsa">ECDSA</SelectItem>
                  <SelectItem value="rsa">RSA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="cert-renew-days">Renew before (days)</Label>
              <Input id="cert-renew-days" type="number" min={1} max={90} value={renewBeforeDays}
                onChange={(e) => setRenewBeforeDays(Number(e.target.value))} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch id="cert-auto" checked={autoRenew} onCheckedChange={setAutoRenew} />
            <Label htmlFor="cert-auto">Automatic renewal</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={busy}>Cancel</Button>
          <Button onClick={onSubmit} disabled={busy || accounts.length === 0}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
