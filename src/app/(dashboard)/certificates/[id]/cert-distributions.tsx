'use client';

import * as React from 'react';
import { Loader2, CloudUpload, Plus, Trash2, PlugZap, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { CertificateDistribution, DistributionConnection } from '@/lib/certs/distribution/types';

const STATUS_CLASS: Record<string, string> = {
  published: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-destructive/10 text-destructive',
  disabled: 'bg-muted text-muted-foreground',
};

export function describeResolved(type: string, t: Record<string, unknown> | null | undefined): string {
  if (!t || Object.keys(t).length === 0) return '—';
  if (type === 'infisical-secrets') return `${t.projectId} / ${t.environment} : ${t.path}`;
  if (type === 'filesystem') return `${t.dir}/live/${t.name}`;
  return JSON.stringify(t);
}

export function CertDistributions({ certId, hasCert, onChanged }: Readonly<{ certId: string; hasCert: boolean; onChanged?: () => void }>) {
  const [rows, setRows] = React.useState<CertificateDistribution[]>([]);
  const [connections, setConnections] = React.useState<DistributionConnection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [connId, setConnId] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [environment, setEnvironment] = React.useState('prod');
  const [path, setPath] = React.useState('/{name}');
  const { confirm, ConfirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    const [d, c] = await Promise.all([api.fetchCertDistributions(certId), api.fetchDistributionConnections()]);
    if (d.data) setRows(d.data);
    if (c.data) setConnections(c.data.connections);
    setLoading(false);
  }, [certId]);

  React.useEffect(() => { load(); }, [load]);

  const selected = connections.find((c) => c.id === connId);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try { await fn(); } finally { setBusy(null); await load(); onChanged?.(); }
  }

  const onPublish = (d: CertificateDistribution) => run(`pub-${d.id}`, async () => {
    const r = await api.publishCertDistribution(certId, d.id);
    if (r.error) setMessage({ ok: false, text: r.error });
    else if (r.data?.action === 'failed') setMessage({ ok: false, text: `${d.connectionName}: ${r.data.error}` });
    else setMessage({ ok: true, text: `${d.connectionName}: ${r.data?.action ?? 'done'}` });
  });

  const onTest = (d: CertificateDistribution) => run(`test-${d.id}`, async () => {
    const r = await api.testCertDistribution(certId, d.id);
    if (r.error) setMessage({ ok: false, text: r.error });
    else setMessage({ ok: !!r.data?.ok, text: `${d.connectionName}: ${r.data?.ok ? r.data.detail ?? 'OK' : r.data?.error}` });
  });

  const onRemove = async (d: CertificateDistribution) => {
    const ok = await confirm({
      title: `Remove destination "${d.connectionName}"?`,
      description: `The certificate and its private key are deleted from ${describeResolved(d.providerType, d.publishedTarget ?? d.resolvedTarget)}, then the destination is removed. Consumers reading it will stop receiving renewals.`,
      confirmLabel: 'Remove', variant: 'destructive',
    });
    if (!ok) return;
    await run(`rm-${d.id}`, async () => {
      const r = await api.removeCertDistribution(certId, d.id);
      if (r.error) setMessage({ ok: false, text: r.error });
    });
  };

  const onAdd = () => run('add', async () => {
    if (!selected) return;
    const target = selected.type === 'infisical-secrets' ? { projectId, environment, path } : {};
    const r = await api.addCertDistribution(certId, selected.id, target);
    if (r.error) { setMessage({ ok: false, text: r.error }); return; }
    const o = r.data?.outcome;
    if (o?.action === 'failed') setMessage({ ok: false, text: `Destination added, but publish failed: ${o.error}` });
    else if (o) setMessage({ ok: true, text: `Destination added and ${o.action}` });
    else setMessage({ ok: true, text: 'Destination added (published once the certificate is issued)' });
    setAdding(false);
    setProjectId('');
  });

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Distributions</CardTitle>
          <CardDescription>Where this certificate is published. Renewals are republished automatically; failures are retried.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}><Plus className="mr-2 h-4 w-4" />Add destination</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-1">
                <Label>Connection</Label>
                <Select value={connId} onValueChange={setConnId}>
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}{c.enabled ? '' : ' (disabled)'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selected?.type === 'infisical-secrets' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Project ID</Label>
                    <Input placeholder="consumer project id" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Environment</Label>
                    <Input value={environment} onChange={(e) => setEnvironment(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Path</Label>
                    <Input value={path} onChange={(e) => setPath(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            {selected?.type === 'infisical-secrets' && (
              <p className="text-xs text-muted-foreground">
                One Infisical project per consumer: the consumer identity gets the built-in <strong>Viewer</strong> role on that project only,
                and this app&apos;s identity must be a <strong>Member</strong> of it. Placeholders: <code>{'{name}'}</code>, <code>{'{category}'}</code>.
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={onAdd} disabled={!selected || busy === 'add' || (selected.type === 'infisical-secrets' && !projectId)}>
                {busy === 'add' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add{hasCert ? ' and publish' : ''}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {message && (
          <div className={`flex items-center gap-2 text-sm ${message.ok ? 'text-green-600' : 'text-destructive'}`}>
            {message.ok ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{message.text}
          </div>
        )}

        {loading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">No destination.</p>}
        {!loading && rows.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connection</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium">{d.connectionName}</div>
                      <div className="text-xs text-muted-foreground">{d.origin === 'auto' ? 'all certificates' : 'this certificate'}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{describeResolved(d.providerType, d.resolvedTarget)}</TableCell>
                    <TableCell>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[d.status]}`}>{d.status}</span>
                      {d.lastError && (
                        <div className="mt-1 max-w-[280px] truncate text-xs text-destructive" title={d.lastError}>{d.lastError}</div>
                      )}
                      {d.status === 'error' && d.nextAttemptAt && (
                        <div className="text-xs text-muted-foreground">retry {formatDate(d.nextAttemptAt * 1000)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{d.publishedAt ? formatDate(d.publishedAt * 1000) : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Test (read-only)" onClick={() => onTest(d)} disabled={!!busy}>
                          {busy === `test-${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" title="Publish now" onClick={() => onPublish(d)} disabled={!!busy || !hasCert || d.status === 'disabled'}>
                          {busy === `pub-${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                        </Button>
                        {d.origin === 'manual' && (
                          <Button variant="ghost" size="icon" title="Remove destination" onClick={() => onRemove(d)} disabled={!!busy}>
                            {busy === `rm-${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <ConfirmDialog />
    </Card>
  );
}
