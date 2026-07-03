'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft, RefreshCw, Download, KeyRound, Trash2 } from 'lucide-react';
import { PageTitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { Certificate, CertEvent, AcmeAccount } from '@/lib/certs/types';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium break-all">{value ?? '—'}</span>
    </div>
  );
}

export default function CertificateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [cert, setCert] = React.useState<Certificate | null>(null);
  const [account, setAccount] = React.useState<AcmeAccount | null>(null);
  const [events, setEvents] = React.useState<CertEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const { confirm, ConfirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    const [c, e, accts] = await Promise.all([api.fetchCertificate(id), api.fetchCertEvents(id), api.fetchAcmeAccounts()]);
    if (c.error || !c.data) { setError(c.error ?? 'not found'); setLoading(false); return; }
    setCert(c.data);
    setEvents(e.data ?? []);
    setAccount((accts.data ?? []).find((a) => a.id === c.data!.acmeAccountId) ?? null);
    setLoading(false);
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  async function patch(p: { autoRenew?: boolean; renewBeforeDays?: number; keyDownloadEnabled?: boolean }) {
    const res = await api.updateCertificateApi(id, p);
    if (res.error) setError(res.error); else setCert(res.data ?? cert);
  }
  async function onIssue() {
    setError(''); setSuccess('');
    const res = await api.issueCertificateApi(id);
    if (res.error) setError(res.error); else { setSuccess('Issuance queued.'); load(); }
  }
  async function onDownloadBundle() {
    setError('');
    const res = await api.downloadCertBundle(id);
    if (res.error || !res.data) { setError(res.error ?? 'download failed'); return; }
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/x-pem-file' }));
    const a = document.createElement('a'); a.href = url; a.download = `${cert!.name}-bundle.pem`; a.click(); URL.revokeObjectURL(url);
  }
  async function onDelete() {
    const ok = await confirm({
      title: `Delete "${cert!.name}"?`,
      description: 'DB row + materialized files deleted. No automatic revocation. Irreversible.',
      confirmLabel: 'Delete', variant: 'destructive',
    });
    if (!ok) return;
    const res = await api.deleteCertificateApi(id);
    if (res.error) setError(res.error); else router.push('/certificates');
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!cert) return (
    <div className="space-y-6">
      <PageTitle title="Certificate" />
      <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error || 'Certificate not found.'}</div>
      <Link href="/certificates" className="text-sm underline">← Back to list</Link>
    </div>
  );

  const ts = (v: number | null) => (v ? formatDate(v * 1000) : '—');

  return (
    <div className="space-y-6">
      <PageTitle title={`Certificate — ${cert.name}`} />
      <div className="flex items-center justify-between">
        <Link href="/certificates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />Back</Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onIssue}><RefreshCw className="mr-2 h-4 w-4" />Issue now</Button>
          {cert.hasCert ? (
            <a href={api.certFullchainDownloadUrl(id)} download={`${cert.name}-fullchain.pem`}>
              <Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" />Chain</Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled><Download className="mr-2 h-4 w-4" />Chain</Button>
          )}
          <Button variant="outline" size="sm" disabled={!cert.hasCert || !cert.keyDownloadEnabled} onClick={onDownloadBundle}><KeyRound className="mr-2 h-4 w-4" />Key + bundle</Button>
          <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
        </div>
      </div>
      {success && <div className="rounded-lg bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">{success}</div>}
      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">State</CardTitle></CardHeader>
            <CardContent>
              <Row label="Status" value={cert.status} />
              <Row label="Renewal" value={cert.renewalStatus} />
              <Row label="Issued at" value={ts(cert.lastIssuedAt)} />
              <Row label="Valid from" value={ts(cert.notBefore)} />
              <Row label="Expires" value={ts(cert.notAfter)} />
              <Row label="Last successful renewal" value={ts(cert.lastRenewalSuccessAt)} />
              <Row label="Next attempt" value={ts(cert.nextAttemptAt)} />
              {cert.lastRenewalError && <Row label="Last error" value={<span className="text-destructive">{cert.errorClass}: {cert.lastRenewalError}</span>} />}
              <Row label="Materialized at" value={ts(cert.materializedAt)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Row label="SAN" value={cert.sans.join(', ')} />
              <Row label="Account" value={account?.name ?? cert.acmeAccountId} />
              <Row label="PDNS server" value={cert.serverUrl} />
              <Row label="Key type" value={cert.keyType} />
              <Row label="Serial" value={cert.serial} />
              <Row label="Fingerprint" value={cert.fingerprintSha256} />
              <Row label="Issuer" value={cert.issuer} />
              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="d-auto">Automatic renewal</Label>
                <Switch id="d-auto" checked={cert.autoRenew} onCheckedChange={(v) => patch({ autoRenew: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="d-key">Allow key download</Label>
                <Switch id="d-key" checked={cert.keyDownloadEnabled} onCheckedChange={(v) => patch({ keyDownloadEnabled: v })} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="d-days">Renew before (days)</Label>
                <Input id="d-days" type="number" min={1} max={90} defaultValue={cert.renewBeforeDays} className="w-24"
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n <= 90 && n !== cert.renewBeforeDays) patch({ renewBeforeDays: n });
                  }} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          {events.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground"><p className="text-sm">No events.</p></div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Actor</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
                <TableBody>
                  {events.map((ev) => (
                    <TableRow key={ev.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(ev.ts * 1000)}</TableCell>
                      <TableCell>{ev.type}</TableCell>
                      <TableCell className="text-muted-foreground">{ev.status ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{ev.actor ?? '—'}{ev.actorIp ? ` (${ev.actorIp})` : ''}</TableCell>
                      <TableCell className="max-w-[320px] truncate" title={ev.message ?? ''}>{ev.message ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog />
    </div>
  );
}
