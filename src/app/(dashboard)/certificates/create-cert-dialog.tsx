'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as api from '@/lib/api';
import type { AcmeAccount } from '@/lib/certs/types';
import type { ServerConnection } from '@/types/powerdns';

export function CreateCertDialog({ accounts, onCreated }: { accounts: AcmeAccount[]; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [connections, setConnections] = React.useState<ServerConnection[]>([]);
  const [name, setName] = React.useState('');
  const [sansText, setSansText] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [connectionId, setConnectionId] = React.useState('');
  const [keyType, setKeyType] = React.useState<'ecdsa' | 'rsa'>('ecdsa');
  const [autoRenew, setAutoRenew] = React.useState(true);
  const [renewBeforeDays, setRenewBeforeDays] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    api.fetchConnections().then((r) => {
      if (r.error) { setError(r.error); return; }
      setConnections(r.data ?? []);
    });
  }, [open]);

  function reset() {
    setName(''); setSansText(''); setAccountId(''); setConnectionId('');
    setKeyType('ecdsa'); setAutoRenew(true); setRenewBeforeDays(30); setError('');
  }

  async function onSubmit() {
    setError('');
    const sans = sansText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!name.trim() || sans.length === 0 || !accountId || !connectionId) {
      setError('Nom, au moins un SAN, un compte et une connexion sont requis.');
      return;
    }
    if (!Number.isInteger(renewBeforeDays) || renewBeforeDays < 1 || renewBeforeDays > 90) {
      setError('Le nombre de jours doit être compris entre 1 et 90.');
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
        <Button>Créer un certificat</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau certificat</DialogTitle>
          <DialogDescription>Émission ACME DNS-01. Les SAN sont canonicalisés côté serveur.</DialogDescription>
        </DialogHeader>
        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cert-name">Nom (identifiant / dossier sur disque)</Label>
            <Input id="cert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="web-prod" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cert-sans">SAN (un par ligne ou séparés par des virgules)</Label>
            <Textarea id="cert-sans" rows={3} value={sansText} onChange={(e) => setSansText(e.target.value)} placeholder={'example.com\n*.example.com'} />
          </div>
          <div className="space-y-2">
            <Label>Compte ACME</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Choisir un compte" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.status !== 'registered' ? ` (${a.status})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Connexion PowerDNS</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger><SelectValue placeholder="Choisir une connexion" /></SelectTrigger>
              <SelectContent>
                {connections.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>Type de clé</Label>
              <Select value={keyType} onValueChange={(v) => setKeyType(v as 'ecdsa' | 'rsa')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ecdsa">ECDSA</SelectItem>
                  <SelectItem value="rsa">RSA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="cert-renew-days">Renouveler avant (jours)</Label>
              <Input id="cert-renew-days" type="number" min={1} max={90} value={renewBeforeDays}
                onChange={(e) => setRenewBeforeDays(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="cert-auto" checked={autoRenew} onCheckedChange={setAutoRenew} />
            <Label htmlFor="cert-auto">Renouvellement automatique</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={busy}>Annuler</Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
