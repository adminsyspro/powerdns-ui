'use client';

import * as React from 'react';
import { Loader2, Trash2, Pencil, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import * as api from '@/lib/api';
import type { AcmeAccount } from '@/lib/certs/types';

const ACCOUNT_STATUS: Record<string, string> = {
  registered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  unregistered: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
};

const LE_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';

type FormState = {
  name: string; directoryUrl: string; caType: 'letsencrypt' | 'other';
  contactEmail: string; eabKid: string; eabHmacKey: string;
  propagationMode: 'authoritative' | 'resolver' | 'delay'; propagationResolver: string; tosAgreed: boolean;
};

const EMPTY: FormState = {
  name: '', directoryUrl: LE_STAGING, caType: 'letsencrypt', contactEmail: '',
  eabKid: '', eabHmacKey: '', propagationMode: 'authoritative', propagationResolver: '', tosAgreed: false,
};

export function AcmeAccountsTab({ onChange }: { onChange: () => void }) {
  const [accounts, setAccounts] = React.useState<AcmeAccount[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AcmeAccount | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    const r = await api.fetchAcmeAccounts();
    if (r.error) setError(r.error); else setAccounts(r.data ?? []);
    setLoading(false);
    onChange();
  }, [onChange]);

  React.useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm(EMPTY); setError(''); setDialogOpen(true); }
  function openEdit(a: AcmeAccount) {
    setEditing(a);
    setForm({
      name: a.name, directoryUrl: a.directoryUrl, caType: a.caType === 'step-ca' ? 'other' : a.caType,
      contactEmail: a.contactEmail ?? '', eabKid: a.eabKid ?? '', eabHmacKey: '',
      propagationMode: a.propagationMode, propagationResolver: a.propagationResolver ?? '', tosAgreed: a.tosAgreed,
    });
    setError(''); setDialogOpen(true);
  }

  async function onSubmit() {
    setError('');
    if (!form.name.trim() || !form.directoryUrl.trim()) { setError('Nom et URL de directory requis.'); return; }
    setBusy(true);
    // AcmeAccountPatch has no `caType` field (immutable after creation), so the
    // common payload below is shared and `caType` is added only for create.
    const common = {
      name: form.name.trim(),
      directoryUrl: form.directoryUrl.trim(),
      contactEmail: form.contactEmail.trim() || undefined,
      eabKid: form.eabKid.trim() || undefined,
      eabHmacKey: form.eabHmacKey.trim() || undefined,
      propagationMode: form.propagationMode,
      propagationResolver: form.propagationMode === 'resolver' ? (form.propagationResolver.trim() || undefined) : undefined,
      tosAgreed: form.tosAgreed,
    };
    const res = editing
      ? await api.updateAcmeAccountApi(editing.id, common)
      : await api.createAcmeAccountApi({ ...common, caType: form.caType });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setDialogOpen(false); load();
  }

  async function onRegister(a: AcmeAccount) {
    setError('');
    if (!a.tosAgreed) { setError(`Cochez l’agrément ToS pour « ${a.name} » avant l’enregistrement.`); return; }
    const res = await api.registerAcmeAccountApi(a.id);
    if (res.error) setError(res.error);
    load();
  }

  async function onDelete(a: AcmeAccount) {
    const ok = await confirm({
      title: `Supprimer le compte « ${a.name} » ?`,
      description: 'Refusé si des certificats l’utilisent encore.',
      confirmLabel: 'Supprimer', variant: 'destructive',
    });
    if (!ok) return;
    const res = await api.deleteAcmeAccountApi(a.id);
    if (res.error) setError(res.error); // 409 in-use surfaces here
    else load();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <div className="flex items-center justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button onClick={openCreate}>Ajouter un compte</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? 'Modifier le compte' : 'Nouveau compte ACME'}</DialogTitle>
              <DialogDescription>Let’s Encrypt ou tout ACME public (EAB supporté). step-ca arrive en Phase 5.</DialogDescription>
            </DialogHeader>
            {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            <div className="space-y-4">
              <div className="space-y-2"><Label>Nom</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Directory URL</Label><Input value={form.directoryUrl} onChange={(e) => setForm({ ...form, directoryUrl: e.target.value })} /></div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <Label>Type de CA</Label>
                  <Select value={form.caType} onValueChange={(v) => setForm({ ...form, caType: v as 'letsencrypt' | 'other' })} disabled={!!editing}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="letsencrypt">Let’s Encrypt</SelectItem><SelectItem value="other">Autre (ACME)</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-2"><Label>Email de contact</Label><Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-2"><Label>EAB KID (optionnel)</Label><Input value={form.eabKid} onChange={(e) => setForm({ ...form, eabKid: e.target.value })} /></div>
                <div className="flex-1 space-y-2">
                  <Label>EAB HMAC key {editing ? '(laisser vide = inchangé)' : '(optionnel)'}</Label>
                  <Input value={form.eabHmacKey} onChange={(e) => setForm({ ...form, eabHmacKey: e.target.value })} placeholder={editing && editing.eabKid ? '•••••• (défini)' : ''} />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <Label>Propagation DNS</Label>
                  <Select value={form.propagationMode} onValueChange={(v) => setForm({ ...form, propagationMode: v as FormState['propagationMode'] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="authoritative">authoritative</SelectItem>
                      <SelectItem value="resolver">resolver</SelectItem>
                      <SelectItem value="delay">delay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.propagationMode === 'resolver' && (
                  <div className="flex-1 space-y-2"><Label>Resolver (IP)</Label><Input value={form.propagationResolver} onChange={(e) => setForm({ ...form, propagationResolver: e.target.value })} placeholder="1.1.1.1" /></div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="tos" checked={form.tosAgreed} onCheckedChange={(v) => setForm({ ...form, tosAgreed: v === true })} />
                <Label htmlFor="tos">J’accepte les conditions d’utilisation (ToS) de la CA</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Annuler</Button>
              <Button onClick={onSubmit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? 'Enregistrer' : 'Créer'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground"><p className="text-sm">Aucun compte ACME. Ajoutez-en un (Let’s Encrypt staging par défaut).</p></div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead><TableHead>CA</TableHead><TableHead>Directory</TableHead>
                <TableHead>Statut</TableHead><TableHead>ToS</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.caType}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-muted-foreground" title={a.directoryUrl}>{a.directoryUrl}</TableCell>
                  <TableCell>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ACCOUNT_STATUS[a.status] ?? 'bg-muted text-muted-foreground'}`}>{a.status}</span>
                    {a.status === 'error' && a.lastError && <div className="mt-1 text-xs text-destructive" title={a.lastError}>{a.lastError.slice(0, 60)}</div>}
                  </TableCell>
                  <TableCell>{a.tosAgreed ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => onRegister(a)} disabled={!a.tosAgreed}>Enregistrer</Button>
                      <Button variant="ghost" size="icon" title="Modifier" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" title="Supprimer" onClick={() => onDelete(a)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog />
    </div>
  );
}
