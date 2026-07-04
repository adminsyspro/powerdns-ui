'use client';

import * as React from 'react';
import { Loader2, ShieldCheck, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { InternalCaStatus } from '@/lib/certs/types';

export function InternalCaTab({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = React.useState<InternalCaStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const load = React.useCallback(async () => {
    const r = await api.fetchInternalCaStatus();
    if (r.error) setError(r.error);
    else setStatus(r.data ?? null);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function onSetup() {
    setError(''); setSuccess(''); setBusy(true);
    const r = await api.setupInternalCaApi();
    setBusy(false);
    if (r.error) setError(r.error);
    else { setSuccess('Internal CA account is set up and registered.'); load(); onChange(); }
  }

  function onDownloadRoot() {
    if (!status?.rootPem) return;
    const blob = new Blob([status.rootPem], { type: 'application/x-pem-file' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'internal-ca-root.pem'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!status?.enabled) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        <p className="text-sm">The bundled internal CA is not enabled. Start step-ca with the <code>internal-ca</code> compose profile and set <code>INTERNAL_CA_ENABLED=true</code>.</p>
      </div>
    );
  }

  const fmt = (t: number | null) => (t ? formatDate(t * 1000) : '—');

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {success && <div className="rounded-lg bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">{success}</div>}

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-5 w-5 text-muted-foreground" />Bundled step-ca</div>
        <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Ready</dt><dd>{status.ready ? 'Yes' : 'No (step-ca not up / root not written yet)'}</dd>
          <dt className="text-muted-foreground">Directory URL</dt><dd className="truncate font-mono text-xs" title={status.directoryUrl ?? ''}>{status.directoryUrl ?? '—'}</dd>
          <dt className="text-muted-foreground">Root fingerprint (SHA-256)</dt><dd className="break-all font-mono text-xs">{status.rootFingerprintSha256 ?? '—'}</dd>
          <dt className="text-muted-foreground">Root expires</dt><dd>{fmt(status.rootNotAfter)}</dd>
          <dt className="text-muted-foreground">Intermediate expires</dt><dd>{fmt(status.intermediateNotAfter)}</dd>
          <dt className="text-muted-foreground">ACME account</dt><dd>{status.account ? `${status.account.name} (${status.account.status})` : 'not created yet'}</dd>
        </dl>
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSetup} disabled={busy || !status.ready}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <RefreshCw className="mr-2 h-4 w-4" />
            {status.account ? 'Reconcile & re-register' : 'Set up internal CA'}
          </Button>
          <Button variant="outline" onClick={onDownloadRoot} disabled={!status.rootPem}>
            <Download className="mr-2 h-4 w-4" />Download root
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Consumers must trust this root. On intermediate rollover, reload the materialized chain (updated on renewal).
        </p>
      </div>
    </div>
  );
}
