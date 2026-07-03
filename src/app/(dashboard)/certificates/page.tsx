'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Download, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { PageTitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { Certificate, AcmeAccount } from '@/lib/certs/types';

const STATUS_BADGE: Record<string, string> = {
  valid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  expired: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  error: 'bg-destructive/10 text-destructive',
};
const RENEWAL_BADGE: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground',
  queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  failed: 'bg-destructive/10 text-destructive',
};

function Pill({ map, value }: { map: Record<string, string>; value: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[value] ?? 'bg-muted text-muted-foreground'}`}>
      {value}
    </span>
  );
}

export default function CertificatesPage() {
  const [certs, setCerts] = React.useState<Certificate[]>([]);
  const [accounts, setAccounts] = React.useState<AcmeAccount[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const { confirm, ConfirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    const [c, a] = await Promise.all([api.fetchCertificates(), api.fetchAcmeAccounts()]);
    if (c.error) setError(c.error);
    else setCerts(c.data ?? []);
    if (!a.error) setAccounts(a.data ?? []);
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  async function onIssue(cert: Certificate) {
    setError(''); setSuccess('');
    const res = await api.issueCertificateApi(cert.id);
    if (res.error) setError(res.error);
    else { setSuccess(`Émission enfilée pour « ${cert.name} ».`); load(); }
  }

  async function onToggleAutoRenew(cert: Certificate, next: boolean) {
    const res = await api.updateCertificateApi(cert.id, { autoRenew: next });
    if (res.error) setError(res.error);
    else setCerts((prev) => prev.map((c) => (c.id === cert.id ? { ...c, autoRenew: next } : c)));
  }

  async function onDownloadBundle(cert: Certificate) {
    setError('');
    const res = await api.downloadCertBundle(cert.id);
    if (res.error || !res.data) { setError(res.error ?? 'download failed'); return; }
    const blob = new Blob([res.data], { type: 'application/x-pem-file' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${cert.name}-bundle.pem`; a.click();
    URL.revokeObjectURL(url);
  }

  async function onDelete(cert: Certificate) {
    const ok = await confirm({
      title: `Supprimer « ${cert.name} » ?`,
      description:
        'La ligne en base et les fichiers matérialisés sur disque seront supprimés. La révocation auprès de la CA n’est pas effectuée automatiquement. Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      variant: 'destructive',
    });
    if (!ok) return;
    const res = await api.deleteCertificateApi(cert.id);
    if (res.error) setError(res.error);
    else { setSuccess(`« ${cert.name} » supprimé.`); load(); }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Certificats SSL" />
      {success && <div className="rounded-lg bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">{success}</div>}
      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Tabs defaultValue="certificates" className="space-y-4">
        <TabsList>
          <TabsTrigger value="certificates">Certificats</TabsTrigger>
          <TabsTrigger value="accounts">Comptes ACME</TabsTrigger>
        </TabsList>

        <TabsContent value="certificates" className="space-y-4">
          <div className="flex items-center justify-end">
            {/* Task 5 replaces this with <CreateCertDialog accounts={accounts} onCreated={load} /> */}
            <Button disabled>Créer un certificat</Button>
          </div>

          {certs.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
              <p className="text-sm">Aucun certificat. Créez-en un pour lancer une émission ACME DNS-01.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>SAN</TableHead>
                    <TableHead>Compte</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Renouvellement</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead>Auto</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certs.map((cert) => (
                    <TableRow key={cert.id}>
                      <TableCell className="font-medium">
                        <Link href={`/certificates/${cert.id}`} className="hover:underline">{cert.name}</Link>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground" title={cert.sans.join(', ')}>
                        {cert.sans.join(', ')}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{accountName(cert.acmeAccountId)}</TableCell>
                      <TableCell><Pill map={STATUS_BADGE} value={cert.status} /></TableCell>
                      <TableCell><Pill map={RENEWAL_BADGE} value={cert.renewalStatus} /></TableCell>
                      <TableCell className="text-muted-foreground">{cert.notAfter ? formatDate(cert.notAfter * 1000) : '—'}</TableCell>
                      <TableCell>
                        <Switch checked={cert.autoRenew} onCheckedChange={(v) => onToggleAutoRenew(cert, v)} aria-label="auto-renew" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Émettre maintenant" onClick={() => onIssue(cert)}>
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <a href={api.certFullchainDownloadUrl(cert.id)} title="Télécharger la chaîne publique" download={`${cert.name}-fullchain.pem`}>
                            <Button variant="ghost" size="icon" disabled={!cert.hasCert}><Download className="h-4 w-4" /></Button>
                          </a>
                          <Button variant="ghost" size="icon" title="Télécharger clé + bundle" disabled={!cert.hasCert || !cert.keyDownloadEnabled} onClick={() => onDownloadBundle(cert)}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Supprimer" onClick={() => onDelete(cert)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="accounts">
          {/* Task 6 replaces this with <AcmeAccountsTab accounts={accounts} onChange={load} /> */}
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            <p className="text-sm">Comptes ACME — à venir.</p>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog />
    </div>
  );
}
