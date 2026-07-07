'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Download, KeyRound, RefreshCw, Trash2, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { PageTitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/hooks/use-confirm';
import { formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import { isCertInProgress, type Certificate, type AcmeAccount } from '@/lib/certs/types';
import { CreateCertDialog } from './create-cert-dialog';
import { AcmeAccountsTab } from './acme-accounts-tab';
import { InternalCaTab } from './internal-ca-tab';
import { CertsOverview } from './certs-overview';

const INTERNAL_CA_UI = process.env.NEXT_PUBLIC_INTERNAL_CA_ENABLED === 'true';

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
    if (a.error) { if (!c.error) setError(a.error); }
    else setAccounts(a.data ?? []);
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // While any cert is mid-issuance/renewal, refresh the list so its loader
  // resolves to valid/error on its own. Stops once nothing is in progress.
  const anyInProgress = certs.some(isCertInProgress);
  React.useEffect(() => {
    if (!anyInProgress) return;
    const t = setInterval(() => { load(); }, 4000);
    return () => clearInterval(t);
  }, [anyInProgress, load]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const categories = React.useMemo(
    () => [...new Set(certs.map((c) => c.category).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [certs],
  );

  async function onIssue(cert: Certificate) {
    setError(''); setSuccess('');
    const res = await api.issueCertificateApi(cert.id);
    if (res.error) setError(res.error);
    else { setSuccess(`Issuance queued for "${cert.name}".`); load(); }
  }

  async function onToggleAutoRenew(cert: Certificate, next: boolean) {
    setError(''); setSuccess('');
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
    setError(''); setSuccess('');
    const ok = await confirm({
      title: `Delete "${cert.name}"?`,
      description:
        'The database row and the materialized files on disk will be deleted. Revocation with the CA is not performed automatically. This action is irreversible.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    const res = await api.deleteCertificateApi(cert.id);
    if (res.error) setError(res.error);
    else {
      setSuccess(`"${cert.name}" deleted.`);
      load();
    }
  }

  const [groupBy, setGroupBy] = React.useState<'none' | 'category' | 'account' | 'status' | 'connection'>('category');
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const groups = React.useMemo(() => {
    if (groupBy === 'none') return null;
    const val = (c: Certificate) =>
      groupBy === 'category' ? (c.category || 'Uncategorized') : groupBy === 'account' ? accountName(c.acmeAccountId) : groupBy === 'status' ? c.status : c.serverUrl;
    const map = new Map<string, Certificate[]>();
    for (const c of certs) {
      const k = val(c) || '—';
      const arr = map.get(k);
      if (arr) arr.push(c);
      else map.set(k, [c]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, items }));
  }, [certs, groupBy, accounts]);

  function renderRow(cert: Certificate) {
    return (
      <TableRow key={cert.id}>
        <TableCell className="font-medium">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Link href={`/certificates/${cert.id}`} className="hover:underline">{cert.name}</Link>
          </span>
        </TableCell>
        <TableCell className="max-w-[220px] truncate text-muted-foreground" title={cert.sans.join(', ')}>
          {cert.sans.join(', ')}
        </TableCell>
        <TableCell className="text-muted-foreground">{accountName(cert.acmeAccountId)}</TableCell>
        <TableCell>
          {cert.status === 'pending' && cert.renewalStatus !== 'failed' ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Issuing…
            </span>
          ) : (
            <Pill map={STATUS_BADGE} value={cert.status} />
          )}
        </TableCell>
        <TableCell>
          {cert.renewalStatus === 'running' || cert.renewalStatus === 'queued' ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />{cert.renewalStatus === 'running' ? 'Renewing…' : 'Queued…'}
            </span>
          ) : (
            <Pill map={RENEWAL_BADGE} value={cert.renewalStatus} />
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">{cert.notAfter ? formatDate(cert.notAfter * 1000) : '—'}</TableCell>
        <TableCell>
          <Switch checked={cert.autoRenew} onCheckedChange={(v) => onToggleAutoRenew(cert, v)} aria-label="auto-renew" />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" title="Issue now" onClick={() => onIssue(cert)}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {cert.hasCert ? (
              <a href={api.certFullchainDownloadUrl(cert.id)} title="Download public chain" download={`${cert.name}-fullchain.pem`}>
                <Button variant="ghost" size="icon"><Download className="h-4 w-4" /></Button>
              </a>
            ) : (
              <Button variant="ghost" size="icon" disabled title="Download public chain"><Download className="h-4 w-4" /></Button>
            )}
            <Button variant="ghost" size="icon" title="Download key + bundle" disabled={!cert.hasCert || !cert.keyDownloadEnabled} onClick={() => onDownloadBundle(cert)}>
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(cert)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
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
      <PageTitle title="SSL Certificates" />
      {success && <div className="rounded-lg bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">{success}</div>}
      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Tabs defaultValue="certificates" className="space-y-4">
        <TabsList>
          <TabsTrigger value="certificates"><ShieldCheck className="mr-2 h-4 w-4" />Certificates</TabsTrigger>
          <TabsTrigger value="accounts"><KeyRound className="mr-2 h-4 w-4" />ACME Accounts</TabsTrigger>
          {INTERNAL_CA_UI && <TabsTrigger value="internal-ca"><ShieldCheck className="mr-2 h-4 w-4" />Internal CA</TabsTrigger>}
        </TabsList>

        <TabsContent value="certificates" className="space-y-4">
          <CertsOverview certs={certs} />

          {certs.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground space-y-3">
              <p className="text-sm">No certificates yet. Create one to start an ACME DNS-01 issuance.</p>
              <CreateCertDialog accounts={accounts} onCreated={load} categories={[]} trigger={<Button>New certificate</Button>} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="group-by" className="text-sm text-muted-foreground">Group by</Label>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                  <SelectTrigger id="group-by" className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="none">No grouping</SelectItem>
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="connection">Connection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>SAN</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Renewal</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Auto</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-2">
                          Actions
                          <CreateCertDialog accounts={accounts} onCreated={load} categories={categories} />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupBy === 'none'
                      ? certs.map(renderRow)
                      : groups!.map((g) => (
                          <React.Fragment key={g.key}>
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={8} className="bg-muted/50 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(g.key)}
                                  className="flex w-full items-center gap-2 text-left text-sm font-medium"
                                >
                                  {collapsed.has(g.key) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  {g.key}
                                  <span className="font-normal text-muted-foreground">({g.items.length})</span>
                                </button>
                              </TableCell>
                            </TableRow>
                            {!collapsed.has(g.key) && g.items.map(renderRow)}
                          </React.Fragment>
                        ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="accounts">
          <AcmeAccountsTab onChange={load} />
        </TabsContent>

        {INTERNAL_CA_UI && (
          <TabsContent value="internal-ca">
            <InternalCaTab onChange={load} />
          </TabsContent>
        )}
      </Tabs>

      <ConfirmDialog />
    </div>
  );
}
