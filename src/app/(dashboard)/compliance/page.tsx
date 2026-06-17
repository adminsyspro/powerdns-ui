'use client';

import * as React from 'react';
import Link from 'next/link';
import { Radar, RefreshCw, Loader2, Search, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useServerConnectionStore } from '@/stores';
import * as api from '@/lib/api';
import type { NsAuditStatus, NsAuditRow } from '@/lib/ns-audit';
import { PageTitle } from '@/components/layout/page-title';

const STATUS_META: Record<NsAuditStatus, { label: string; badgeClass: string; description: string }> = {
  foreign: {
    label: 'Foreign',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    description: 'No pool nameserver in the public delegation — zone is hosted elsewhere',
  },
  mixed: {
    label: 'Extra NS',
    badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    description: 'Pool present but foreign nameservers are also delegated — check zone transfer permissions',
  },
  incomplete: {
    label: 'Partial pool',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    description: 'Only part of the pool is delegated (e.g. a single pool nameserver)',
  },
  ok: {
    label: 'Compliant',
    badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    description: 'Public delegation matches the pool exactly',
  },
  'no-ns': {
    label: 'Not delegated',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    description: 'No public NS records found (domain unregistered, expired or not delegated)',
  },
  error: {
    label: 'Lookup failed',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    description: 'The DNS lookup failed — retry with a new scan',
  },
};

// Anomalies first, compliant and unresolvable states last.
const STATUS_ORDER: NsAuditStatus[] = ['foreign', 'mixed', 'incomplete', 'ok', 'no-ns', 'error'];

function NsChip({ ns, tone }: { ns: string; tone: 'pool' | 'foreign' | 'missing' }) {
  const classes =
    tone === 'pool'
      ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
      : tone === 'foreign'
        ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
        : 'border-amber-300 bg-amber-50 text-amber-700 line-through dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-mono ${classes}`}>
      {ns}
    </span>
  );
}

export default function CompliancePage() {
  const { activeConnection } = useServerConnectionStore();
  const [data, setData] = React.useState<api.NsAuditResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<NsAuditStatus | 'all'>('all');
  const [search, setSearch] = React.useState('');

  const load = React.useCallback(async () => {
    const result = await api.fetchNsAudit();
    if (result.data) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error || 'Failed to load audit results');
    }
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    if (activeConnection) load();
  }, [activeConnection, load]);

  // Poll while a scan is running so progress and results refresh live.
  const scanning = data?.scan.running ?? false;
  React.useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [scanning, load]);

  const handleScan = async () => {
    setError(null);
    const result = await api.startNsAuditScan();
    if (result.error) setError(result.error);
    await load();
  };

  const results = data?.results ?? [];
  const filtered = results.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (search && !row.zoneName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  // Within the current filter, surface anomalies first.
  const sorted = [...filtered].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.zoneName.localeCompare(b.zoneName)
  );

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="space-y-6">
      <PageTitle title="NS Audit" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-muted-foreground">
            Public delegation of each forward zone compared to the default nameserver pool
            {data?.scan.poolName && (
              <> — pool <span className="font-medium">{data.scan.poolName}</span>{' '}
                <span className="font-mono text-xs">({data.scan.poolNameservers.map((ns) => ns.replace(/\.$/, '')).join(', ')})</span>
              </>
            )}
          </p>
          {data?.lastCheckedAt && !scanning && (
            <p className="text-xs text-muted-foreground mt-1">Last scan: {formatDate(data.lastCheckedAt)}</p>
          )}
        </div>
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scanning {data?.scan.scanned}/{data?.scan.total}</>
          ) : (
            <><Radar className="mr-2 h-4 w-4" />Scan zones</>
          )}
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Summary cards (clickable filters) */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-7">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${statusFilter === 'all' ? 'border-primary ring-1 ring-primary' : ''}`}
        >
          <p className="text-2xl font-bold">{results.length}</p>
          <p className="text-xs text-muted-foreground">All zones</p>
        </button>
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
            title={STATUS_META[status].description}
            className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${statusFilter === status ? 'border-primary ring-1 ring-primary' : ''}`}
          >
            <p className="text-2xl font-bold">{data?.counts[status] ?? 0}</p>
            <p className="text-xs text-muted-foreground">{STATUS_META[status].label}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter zones..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12">
              <Radar className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No audit results yet</h3>
              <p className="text-muted-foreground">Run a scan to compare every zone&apos;s public delegation to the pool</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-100 dark:bg-slate-800">
                <TableRow>
                  <TableHead className="font-semibold">Zone</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Delegated nameservers</TableHead>
                  <TableHead className="font-semibold">Missing from pool</TableHead>
                  <TableHead className="font-semibold whitespace-nowrap">Checked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row: NsAuditRow) => (
                  <TableRow key={row.zoneId}>
                    <TableCell>
                      <Link href={`/zones/${encodeURIComponent(row.zoneId)}`} className="font-medium hover:underline">
                        {row.zoneName.replace(/\.$/, '')}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_META[row.status].badgeClass} title={STATUS_META[row.status].description}>
                        {STATUS_META[row.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.delegated.length === 0 && (
                          <span className="text-xs text-muted-foreground">{row.error || '—'}</span>
                        )}
                        {row.delegated.map((ns) => (
                          <NsChip
                            key={ns}
                            ns={ns}
                            tone={row.inPool.includes(ns.toLowerCase().replace(/\.$/, '')) ? 'pool' : 'foreign'}
                          />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.missing.map((ns) => (
                          <NsChip key={ns} ns={ns} tone="missing" />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(row.checkedAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      No zone matches the current filter
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
