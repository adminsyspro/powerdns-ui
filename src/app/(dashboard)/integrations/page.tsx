'use client';

import * as React from 'react';
import Link from 'next/link';
import { Cloud, Plus, RefreshCw, Loader2, Trash2, Pencil, CheckCircle2, XCircle, Send, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/hooks/use-confirm';
import { useServerConnectionStore } from '@/stores';
import * as api from '@/lib/api';
import type { IntegrationRow, IntegrationZoneRow, IntegrationConfig } from '@/lib/integrations/types';
import type { IntegrationSyncState } from '@/lib/integrations/sync';

// Available providers. The framework is provider-based: add an entry here
// (plus a lib/integrations/<provider>.ts implementation) to surface a new one.
const PROVIDERS: Array<{
  id: 'cloudflare';
  label: string;
  logo: string;
  description: string;
}> = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    logo: '/integrations/cloudflare.png',
    description: 'Secondary DNS (AXFR) + orange-cloud proxy',
  },
];

const ZONE_STATUS_BADGE: Record<string, string> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  provisioning: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  stale: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  orphan: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

interface FormState {
  provider: 'cloudflare';
  name: string;
  apiToken: string;
  accountId: string;
  primaryIp: string;
  primaryPort: string;
  tsigName: string;
  tsigAlgo: string;
  tsigSecret: string;
  scope: 'all-master' | 'groups' | 'zones';
  groups: string[];
  zones: string[];
  customNsMode: 'ignore' | 'enable' | 'disable';
  customNsSet: string;
  autoProvision: boolean;
  deleteMode: 'never' | 'delete';
  connectionId: string;
}

const EMPTY_FORM: FormState = {
  provider: 'cloudflare',
  name: '', apiToken: '', accountId: '', primaryIp: '', primaryPort: '53',
  tsigName: '', tsigAlgo: 'hmac-sha256.', tsigSecret: '',
  scope: 'all-master', groups: [], zones: [],
  customNsMode: 'ignore', customNsSet: '1',
  autoProvision: true, deleteMode: 'never',
  connectionId: '',
};

// Searchable multi-picker over the cached zones (the scope may target a few
// domains out of thousands, so a plain select doesn't work).
function ZonePicker({ selected, onChange }: { selected: string[]; onChange: (zones: string[]) => void }) {
  const [search, setSearch] = React.useState('');
  const [results, setResults] = React.useState<{ id: string; name: string }[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  React.useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const result = await api.fetchCachedZones({
        page: 1, pageSize: 8, search: search.trim(), sortBy: 'name', sortOrder: 'asc',
      });
      setResults(result.data?.items.map((z) => ({ id: z.id, name: z.name })) ?? []);
      setIsSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const add = (name: string) => {
    if (!selected.includes(name)) onChange([...selected, name]);
    setSearch('');
    setResults([]);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          placeholder="Search a zone to add..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
            {isSearching ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No matching zone</p>
            ) : (
              results.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                  disabled={selected.includes(zone.name)}
                  onClick={() => add(zone.name)}
                >
                  {zone.name.replace(/\.$/, '')}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {selected.map((zone) => (
          <Badge key={zone} variant="secondary" className="gap-1">
            {zone.replace(/\.$/, '')}
            <button
              type="button"
              onClick={() => onChange(selected.filter((z) => z !== zone))}
              aria-label={`Remove ${zone}`}
              className="ml-1 hover:text-destructive"
            >
              ×
            </button>
          </Badge>
        ))}
        {selected.length === 0 && (
          <p className="text-xs text-muted-foreground">No zone selected yet</p>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = React.useState<IntegrationRow[]>([]);
  const [stats, setStats] = React.useState<api.IntegrationStats | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<{ connectionMissing: boolean; zones: IntegrationZoneRow[]; sync: IntegrationSyncState } | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ id: string; ok: boolean; message: string } | null>(null);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<IntegrationRow | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  // Groups available for the scope selector.
  const [allGroups, setAllGroups] = React.useState<{ slug: string; name: string }[]>([]);
  React.useEffect(() => {
    api.fetchGroups().then((result) => {
      if (result.data) setAllGroups(result.data.map((g) => ({ slug: g.slug, name: g.name })));
    });
  }, []);
  const [isSaving, setIsSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const { connections, activeConnection } = useServerConnectionStore();

  // Pagination for the replicated-zones table (client-side over the loaded list).
  const [zonesPage, setZonesPage] = React.useState(1);
  const [zonesPageSize, setZonesPageSize] = React.useState(10);

  // Custom-NS sets available on the Cloudflare account (loaded on demand for
  // the set selector; needs the account id plus a token — typed or stored).
  const [nsSets, setNsSets] = React.useState<Array<{ set: number; nameservers: string[] }> | null>(null);
  const [nsSetsError, setNsSetsError] = React.useState<string | null>(null);
  const [nsSetsLoading, setNsSetsLoading] = React.useState(false);
  const canLoadNsSets = Boolean(form.accountId.trim() && (form.apiToken.trim() || editing));
  const loadNsSets = React.useCallback(async () => {
    setNsSetsLoading(true);
    setNsSetsError(null);
    const result = await api.fetchCustomNsSets({
      accountId: form.accountId.trim(),
      ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}),
      ...(editing ? { integrationId: editing.id } : {}),
    });
    if (result.data) {
      const sets = result.data.sets;
      setNsSets(sets);
      if (sets.length === 0) setNsSetsError('No custom nameserver set found on this account');
      // Normalize an empty/blank selection to the first available set so the
      // selector never renders an empty SelectItem value.
      if (sets.length > 0) {
        setForm((prev) => (prev.customNsSet.trim() ? prev : { ...prev, customNsSet: String(sets[0].set) }));
      }
    } else {
      setNsSets(null);
      setNsSetsError(result.error || 'Failed to load nameserver sets');
    }
    setNsSetsLoading(false);
  }, [form.accountId, form.apiToken, editing]);

  const nsSetsRequestedRef = React.useRef(false);
  // Editing the account or token invalidates previously loaded sets — they
  // belong to the old credentials. Declared BEFORE the auto-load effect so,
  // on the render where credentials change, the flag is already cleared when
  // the auto-load effect runs and the refetch actually happens.
  React.useEffect(() => {
    nsSetsRequestedRef.current = false;
    setNsSets(null);
    setNsSetsError(null);
  }, [form.accountId, form.apiToken]);
  // Auto-load once when switching to "enable" with enough info available.
  React.useEffect(() => {
    if (form.customNsMode === 'enable' && canLoadNsSets && !nsSetsRequestedRef.current) {
      nsSetsRequestedRef.current = true;
      loadNsSets();
    }
  }, [form.customNsMode, canLoadNsSets, loadNsSets]);
  React.useEffect(() => {
    if (!dialogOpen) {
      nsSetsRequestedRef.current = false;
      setNsSets(null);
      setNsSetsError(null);
    }
  }, [dialogOpen]);

  const load = React.useCallback(async () => {
    const [result, statsResult] = await Promise.all([api.fetchIntegrations(), api.fetchIntegrationStats()]);
    if (result.data) {
      const list = result.data;
      setIntegrations(list);
      // Keep the replicated-zones table always visible: auto-select the
      // first integration (and recover when the selected one was deleted).
      setSelectedId((prev) => (prev && list.some((i) => i.id === prev) ? prev : list[0]?.id ?? null));
      setError(null);
    } else {
      setError(result.error || 'Failed to load integrations');
    }
    if (statsResult.data) setStats(statsResult.data);
    setIsLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const loadDetail = React.useCallback(async (id: string) => {
    const [result, statsResult] = await Promise.all([
      api.fetchIntegrationDetail(id),
      api.fetchIntegrationStats(),
    ]);
    if (result.data) setDetail({ connectionMissing: result.data.connectionMissing, zones: result.data.zones, sync: result.data.sync });
    if (statsResult.data) setStats(statsResult.data);
  }, []);

  React.useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // Reset to the first page when switching integrations.
  React.useEffect(() => { setZonesPage(1); }, [selectedId]);

  // Poll while a sync runs.
  const syncRunning = detail?.sync.running ?? false;
  React.useEffect(() => {
    if (!syncRunning || !selectedId) return;
    const timer = setInterval(() => loadDetail(selectedId), 2000);
    return () => clearInterval(timer);
  }, [syncRunning, selectedId, loadDetail]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, connectionId: activeConnection?.id ?? connections[0]?.id ?? '' });
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (integration: IntegrationRow) => {
    setEditing(integration);
    setForm({
      provider: integration.provider,
      name: integration.name,
      apiToken: '',
      accountId: integration.config.accountId,
      primaryIp: integration.config.primaryIp,
      primaryPort: String(integration.config.primaryPort || 53),
      tsigName: integration.config.tsigName || '',
      tsigAlgo: integration.config.tsigAlgo || 'hmac-sha256.',
      tsigSecret: '',
      scope: integration.config.scope,
      groups: integration.config.groups,
      zones: integration.config.zones,
      customNsMode: integration.config.customNsMode,
      customNsSet: String(integration.config.customNsSet || 1),
      autoProvision: integration.config.autoProvision,
      deleteMode: integration.config.deleteMode,
      connectionId: integration.connectionId ?? '',
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const buildConfig = (): Partial<IntegrationConfig> => ({
    mode: 'axfr',
    accountId: form.accountId.trim(),
    primaryIp: form.primaryIp.trim(),
    primaryPort: parseInt(form.primaryPort, 10) || 53,
    tsigName: form.tsigName.trim() || undefined,
    tsigAlgo: form.tsigAlgo.trim() || undefined,
    scope: form.scope,
    groups: form.groups,
    zones: form.zones,
    customNsMode: form.customNsMode,
    customNsSet: parseInt(form.customNsSet, 10) || 1,
    autoProvision: form.autoProvision,
    deleteMode: form.deleteMode,
  });

  const handleSave = async () => {
    setIsSaving(true);
    setFormError(null);
    const result = editing
      ? await api.updateIntegrationApi(editing.id, {
          name: form.name.trim(),
          config: buildConfig(),
          connectionId: form.connectionId,
          ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}),
          ...(form.tsigSecret ? { tsigSecret: form.tsigSecret } : {}),
        })
      : await api.createIntegrationApi({
          provider: form.provider,
          name: form.name.trim(),
          apiToken: form.apiToken.trim(),
          tsigSecret: form.tsigSecret || undefined,
          config: buildConfig(),
          connectionId: form.connectionId,
        });
    if (result.error) {
      setFormError(result.error);
    } else {
      setDialogOpen(false);
      await load();
      if (editing && selectedId === editing.id) await loadDetail(editing.id);
    }
    setIsSaving(false);
  };

  const handleDelete = async (integration: IntegrationRow) => {
    const ok = await confirm({
      title: 'Delete integration',
      description: `Delete "${integration.name}"? Remote Cloudflare zones are NOT touched; only the link and its history are removed.`,
    });
    if (!ok) return;
    await api.deleteIntegrationApi(integration.id);
    if (selectedId === integration.id) setSelectedId(null);
    await load();
  };

  const handleTest = async (integration: IntegrationRow) => {
    setTestResult(null);
    const result = await api.testIntegration(integration.id);
    if (result.data?.ok) {
      setTestResult({ id: integration.id, ok: true, message: `Token OK — ${result.data.remoteZones} zone(s) visible on the account` });
    } else {
      setTestResult({ id: integration.id, ok: false, message: result.data?.error || result.error || 'Test failed' });
    }
  };

  const handleSync = async () => {
    if (!selectedId) return;
    setError(null);
    const result = await api.startIntegrationSync(selectedId);
    if (result.error) setError(result.error);
    await loadDetail(selectedId);
  };

  const handleForceAxfr = async (zoneName: string) => {
    if (!selectedId) return;
    const result = await api.forceIntegrationAxfr(selectedId, zoneName);
    if (result.error) setError(result.error);
    else await loadDetail(selectedId);
  };

  const handleToggleActive = async (integration: IntegrationRow) => {
    await api.updateIntegrationApi(integration.id, { active: !integration.active });
    await load();
  };

  const formatDate = (ts: number) =>
    new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  const selected = integrations.find((i) => i.id === selectedId) ?? null;

  const zonesTotalPages = Math.max(1, Math.ceil((detail?.zones.length ?? 0) / zonesPageSize));
  const paginatedZones = detail
    ? detail.zones.slice((zonesPage - 1) * zonesPageSize, zonesPage * zonesPageSize)
    : [];
  // Clamp the page if the list shrank (sync removed zones, smaller page size).
  React.useEffect(() => {
    if (zonesPage > zonesTotalPages) setZonesPage(zonesTotalPages);
  }, [zonesPage, zonesTotalPages]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/integrations/cloudflare-icon.svg" alt="Cloudflare" className="h-8 w-8 object-contain" />
            Cloudflare
          </h1>
          <p className="text-muted-foreground">
            DNS zone replication to Cloudflare — secondary DNS (AXFR), automatic zone provisioning,
            custom nameservers and per-record proxy (cache/WAF)
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />New integration
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Replication dashboard */}
      {stats && integrations.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border p-4">
              <p className="text-2xl font-bold">{stats.totals.scope}</p>
              <p className="text-xs text-muted-foreground">Zones in scope</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-2xl font-bold text-green-600">{stats.totals.ok}</p>
              <p className="text-xs text-muted-foreground">Replicated</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className={`text-2xl font-bold ${stats.totals.error > 0 ? 'text-red-600' : ''}`}>{stats.totals.error}</p>
              <p className="text-xs text-muted-foreground">Errors</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className={`text-2xl font-bold ${stats.totals.pending > 0 ? 'text-amber-600' : ''}`}>{stats.totals.pending}</p>
              <p className="text-xs text-muted-foreground">Pending (provisioning / stale)</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className={`text-2xl font-bold ${stats.totals.orphan > 0 ? 'text-amber-600' : ''}`}>{stats.totals.orphan}</p>
              <p className="text-xs text-muted-foreground">Orphans</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-2xl font-bold">
                {stats.totals.scope > 0 ? `${Math.round((stats.totals.ok / stats.totals.scope) * 100)}%` : '—'}
              </p>
              <p className="text-xs text-muted-foreground">Coverage</p>
            </div>
          </div>
          {/* Coverage bar */}
          {stats.totals.scope > 0 && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, Math.round((stats.totals.ok / stats.totals.scope) * 100))}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.totals.ok} of {stats.totals.scope} zone(s) in scope replicated to Cloudflare
                {stats.totals.lastActivity && ` — last activity ${formatDate(stats.totals.lastActivity)}`}
              </p>
            </div>
          )}
        </div>
      )}

      <h2 className="text-lg font-semibold pt-2">Configuration</h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : integrations.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Cloud className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No integration yet</h3>
            <p className="text-muted-foreground">
              Connect a Cloudflare account to provision secondary zones automatically — no more manual zone creation when AXFR can&apos;t do it
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1">
          {integrations.map((integration) => (
            <Card
              key={integration.id}
              className={`transition-colors ${integrations.length > 1 ? 'cursor-pointer hover:bg-muted/30' : ''} ${selectedId === integration.id && integrations.length > 1 ? 'border-primary ring-1 ring-primary' : ''}`}
              onClick={() => setSelectedId(integration.id)}
            >
              <CardContent className="flex items-center gap-4 py-4 flex-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={PROVIDERS.find((p) => p.id === integration.provider)?.logo || '/integrations/cloudflare.png'}
                  alt={integration.provider}
                  className="h-6 object-contain flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-medium flex items-center gap-2">
                    {integration.name}
                    {!integration.active && <Badge variant="secondary">Inactive</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    {integration.config.mode.toUpperCase()} · {
                      integration.config.scope === 'all-master' ? 'all Master zones'
                      : integration.config.scope === 'groups' ? `groups: ${integration.config.groups.join(', ') || '—'}`
                      : `${integration.config.zones.length} selected zone(s)`
                    }
                    {integration.config.customNsMode === 'enable' && ` · custom NS set ${integration.config.customNsSet}`}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" size="sm" onClick={() => handleTest(integration)}>Test</Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(integration)} aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(integration)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Switch checked={integration.active} onCheckedChange={() => handleToggleActive(integration)} aria-label="Active" />
                </div>
                {testResult?.id === integration.id && (
                  <p className={`w-full text-xs flex items-center gap-1 ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                    {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {testResult.message}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail: per-zone replication state */}
      {selected && detail && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Replicated zones — {selected.name}</CardTitle>
              <CardDescription>
                {detail.zones.length} tracked zone(s)
                {detail.sync.finishedAt && !detail.sync.running && ` — last sync ${formatDate(detail.sync.finishedAt)}`}
              </CardDescription>
            </div>
            <Button onClick={handleSync} disabled={detail.sync.running}>
              {detail.sync.running ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing {detail.sync.processed}/{detail.sync.total}</>
              ) : (
                <><RefreshCw className="mr-2 h-4 w-4" />Sync zones</>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            {detail.connectionMissing ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                This integration&apos;s PowerDNS connection is missing or was deleted — edit the integration to rebind it to a connection.
              </div>
            ) : detail.zones.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No zone tracked yet — run a sync to provision every Master zone in scope at Cloudflare
              </p>
            ) : (
              <>
              <Table>
                <TableHeader className="bg-slate-100 dark:bg-slate-800">
                  <TableRow>
                    <TableHead className="font-semibold">Zone</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Message</TableHead>
                    <TableHead className="font-semibold whitespace-nowrap">Updated</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedZones.map((zone) => (
                    <TableRow key={zone.zoneName}>
                      <TableCell>
                        <Link href={`/zones/${encodeURIComponent(zone.zoneName)}`} className="font-medium hover:underline">
                          {zone.zoneName.replace(/\.$/, '')}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge className={ZONE_STATUS_BADGE[zone.status] || ''}>{zone.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[360px] truncate" title={zone.message || ''}>
                        {zone.message || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(zone.updatedAt)}
                      </TableCell>
                      <TableCell>
                        {zone.remoteZoneId && zone.status !== 'orphan' && (
                          <Button variant="outline" size="sm" onClick={() => handleForceAxfr(zone.zoneName)}>
                            <Send className="mr-1.5 h-3.5 w-3.5" />Force AXFR
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {detail.zones.length > zonesPageSize && (
                <div className="flex items-center justify-between pt-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      Showing {(zonesPage - 1) * zonesPageSize + 1}-{Math.min(zonesPage * zonesPageSize, detail.zones.length)} of {detail.zones.length} zone(s)
                    </span>
                    <Select
                      value={String(zonesPageSize)}
                      onValueChange={(value) => { setZonesPageSize(Number.parseInt(value, 10)); setZonesPage(1); }}
                    >
                      <SelectTrigger className="w-[80px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                    <span>per page</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZonesPage(1)} disabled={zonesPage <= 1}>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZonesPage(zonesPage - 1)} disabled={zonesPage <= 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-3 text-sm">
                      Page {zonesPage} of {zonesTotalPages}
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZonesPage(zonesPage + 1)} disabled={zonesPage >= zonesTotalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZonesPage(zonesTotalPages)} disabled={zonesPage >= zonesTotalPages}>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New integration'}</DialogTitle>
            <DialogDescription>
              Cloudflare secondary DNS (AXFR) — requires an Enterprise plan with Secondary DNS
              {editing ? '. Leave the token empty to keep the stored one.' : ''}
            </DialogDescription>
          </DialogHeader>

          {/* Provider selector — the provider of an existing integration is fixed */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!!editing}
                onClick={() => setForm({ ...form, provider: provider.id })}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  form.provider === provider.id ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/50'
                } ${editing ? 'opacity-70 cursor-default' : ''}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={provider.logo} alt={provider.label} className="h-6 object-contain mb-2" />
                <p className="text-xs text-muted-foreground">{provider.description}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="int-name">Name</Label>
              <Input id="int-name" placeholder="Cloudflare production" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="int-connection">PowerDNS connection</Label>
              <Select value={form.connectionId} onValueChange={(v) => setForm({ ...form, connectionId: v })}>
                <SelectTrigger id="int-connection"><SelectValue placeholder="Select a connection" /></SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Zones from this connection are replicated by this integration.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="int-account">Cloudflare account ID</Label>
              <Input id="int-account" placeholder="023e105f4ecef8ad9ca31a8372d0c353" value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="int-token">API token{editing && <span className="text-muted-foreground"> (unchanged if empty)</span>}</Label>
              <Input id="int-token" type="password" autoComplete="off" value={form.apiToken}
                onChange={(e) => setForm({ ...form, apiToken: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                Scopes needed: Zone&nbsp;:&nbsp;Edit, DNS&nbsp;:&nbsp;Edit, Secondary&nbsp;DNS&nbsp;:&nbsp;Edit on the account
                — plus Account&nbsp;Settings&nbsp;:&nbsp;Read and Zone&nbsp;Settings&nbsp;:&nbsp;Edit when managing custom nameservers
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="int-ip">PowerDNS primary IP (public)</Label>
              <Input id="int-ip" placeholder="203.0.113.5" value={form.primaryIp}
                onChange={(e) => setForm({ ...form, primaryIp: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="int-port">Primary port</Label>
              <Input id="int-port" placeholder="53" value={form.primaryPort}
                onChange={(e) => setForm({ ...form, primaryPort: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="int-tsig-name">TSIG key name <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="int-tsig-name" placeholder="cf-axfr-key" value={form.tsigName}
                onChange={(e) => setForm({ ...form, tsigName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="int-tsig-secret">TSIG secret</Label>
              <Input id="int-tsig-secret" type="password" autoComplete="off" value={form.tsigSecret}
                onChange={(e) => setForm({ ...form, tsigSecret: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="int-scope">Zone scope</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as FormState['scope'] })}>
                <SelectTrigger id="int-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-master">All Master zones</SelectItem>
                  <SelectItem value="groups">Only selected groups</SelectItem>
                  <SelectItem value="zones">Only selected zones</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scope === 'groups' && (
              <div className="space-y-2">
                <Label>Groups</Label>
                {allGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No groups defined — manage the list in Administration &rarr; Groups
                  </p>
                ) : (
                  <div className="rounded-md border p-2 max-h-40 overflow-y-auto space-y-1">
                    {allGroups.map((group) => (
                      <label key={group.slug} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded hover:bg-muted">
                        <Checkbox
                          checked={form.groups.includes(group.slug)}
                          onCheckedChange={(checked) => setForm({
                            ...form,
                            groups: checked
                              ? [...form.groups, group.slug]
                              : form.groups.filter((g) => g !== group.slug),
                          })}
                        />
                        {group.name} <span className="text-muted-foreground font-mono text-xs">({group.slug})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {form.scope === 'zones' && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Zones to replicate</Label>
                <ZonePicker selected={form.zones} onChange={(zones) => setForm({ ...form, zones })} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="int-delete">On zone deletion</Label>
              <Select value={form.deleteMode} onValueChange={(v) => setForm({ ...form, deleteMode: v as FormState['deleteMode'] })}>
                <SelectTrigger id="int-delete"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Keep the remote zone (flag as orphan)</SelectItem>
                  <SelectItem value="delete">Delete the remote zone too</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Account custom nameservers */}
            <div className="sm:col-span-2 p-4 border rounded-lg space-y-3">
              <div className="space-y-0.5">
                <Label htmlFor="int-custom-ns">Account custom nameservers</Label>
                <p className="text-sm text-muted-foreground">
                  Serve provisioned zones on your account&apos;s custom nameservers (e.g. ns1.your-domain.com)
                  instead of Cloudflare-branded ones. &ldquo;Don&apos;t manage&rdquo; never touches the
                  zone setting, so manually configured zones stay as they are.
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={form.customNsMode} onValueChange={(v) => setForm({ ...form, customNsMode: v as FormState['customNsMode'] })}>
                  <SelectTrigger id="int-custom-ns" className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ignore">Don&apos;t manage (leave zones as they are)</SelectItem>
                    <SelectItem value="enable">Enable custom nameservers</SelectItem>
                    <SelectItem value="disable">Disable (Cloudflare-branded NS)</SelectItem>
                  </SelectContent>
                </Select>
                {form.customNsMode === 'enable' && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="int-ns-set" className="text-sm font-normal whitespace-nowrap">Nameserver set</Label>
                    {nsSets && nsSets.length > 0 ? (
                      <Select value={form.customNsSet} onValueChange={(v) => setForm({ ...form, customNsSet: v })}>
                        <SelectTrigger id="int-ns-set" className="w-96"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {nsSets.map(({ set, nameservers }) => (
                            <SelectItem key={set} value={String(set)}>
                              Set {set} — {nameservers.map((ns) => ns.replace(/\.$/, '')).join(', ')}
                            </SelectItem>
                          ))}
                          {/* Preserve a configured set that no longer exists on the account
                              (Radix forbids empty SelectItem values, hence the guard) */}
                          {form.customNsSet.trim() && !nsSets.some((s) => String(s.set) === form.customNsSet) && (
                            <SelectItem value={form.customNsSet}>Set {form.customNsSet} (not found on account)</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id="int-ns-set" className="w-20" value={form.customNsSet}
                        onChange={(e) => setForm({ ...form, customNsSet: e.target.value })} />
                    )}
                    <Button type="button" variant="outline" size="sm" disabled={!canLoadNsSets || nsSetsLoading} onClick={loadNsSets}>
                      {nsSetsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Load sets'}
                    </Button>
                  </div>
                )}
              </div>
              {form.customNsMode === 'enable' && !canLoadNsSets && (
                <p className="text-xs text-muted-foreground">Fill in the account ID and API token to list the available sets</p>
              )}
              {form.customNsMode === 'enable' && nsSetsError && (
                <p className="text-xs text-destructive">{nsSetsError}</p>
              )}
            </div>

            <div className="flex items-center justify-between sm:col-span-2 p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="int-auto">Auto-provision new zones</Label>
                <p className="text-sm text-muted-foreground">
                  Create the Cloudflare secondary zone automatically when a matching zone is created here
                </p>
              </div>
              <Switch id="int-auto" checked={form.autoProvision}
                onCheckedChange={(checked) => setForm({ ...form, autoProvision: checked })} />
            </div>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={isSaving || !form.name.trim() || (!editing && !form.apiToken.trim()) || !form.connectionId}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
}
