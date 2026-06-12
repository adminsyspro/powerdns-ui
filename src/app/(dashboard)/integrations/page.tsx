'use client';

import * as React from 'react';
import Link from 'next/link';
import { Cloud, Plus, RefreshCw, Loader2, Trash2, Pencil, CheckCircle2, XCircle, Send } from 'lucide-react';
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
  autoProvision: boolean;
  deleteMode: 'never' | 'delete';
}

const EMPTY_FORM: FormState = {
  provider: 'cloudflare',
  name: '', apiToken: '', accountId: '', primaryIp: '', primaryPort: '53',
  tsigName: '', tsigAlgo: 'hmac-sha256.', tsigSecret: '',
  scope: 'all-master', groups: [], zones: [], autoProvision: true, deleteMode: 'never',
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
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<{ zones: IntegrationZoneRow[]; sync: IntegrationSyncState } | null>(null);
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

  const load = React.useCallback(async () => {
    const result = await api.fetchIntegrations();
    if (result.data) {
      setIntegrations(result.data);
      setError(null);
    } else {
      setError(result.error || 'Failed to load integrations');
    }
    setIsLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const loadDetail = React.useCallback(async (id: string) => {
    const result = await api.fetchIntegrationDetail(id);
    if (result.data) setDetail({ zones: result.data.zones, sync: result.data.sync });
  }, []);

  React.useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // Poll while a sync runs.
  const syncRunning = detail?.sync.running ?? false;
  React.useEffect(() => {
    if (!syncRunning || !selectedId) return;
    const timer = setInterval(() => loadDetail(selectedId), 2000);
    return () => clearInterval(timer);
  }, [syncRunning, selectedId, loadDetail]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
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
      autoProvision: integration.config.autoProvision,
      deleteMode: integration.config.deleteMode,
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
          ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}),
          ...(form.tsigSecret ? { tsigSecret: form.tsigSecret } : {}),
        })
      : await api.createIntegrationApi({
          provider: form.provider,
          name: form.name.trim(),
          apiToken: form.apiToken.trim(),
          tsigSecret: form.tsigSecret || undefined,
          config: buildConfig(),
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground">
            Replicate zones to external providers — Cloudflare secondary DNS (AXFR) with automatic zone provisioning and per-record proxy
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />New integration
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration) => (
            <Card
              key={integration.id}
              className={`cursor-pointer transition-colors hover:bg-muted/30 ${selectedId === integration.id ? 'border-primary ring-1 ring-primary' : ''}`}
              onClick={() => setSelectedId(selectedId === integration.id ? null : integration.id)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={PROVIDERS.find((p) => p.id === integration.provider)?.logo || '/integrations/cloudflare.png'}
                    alt={integration.provider}
                    className="h-5 object-contain"
                  />
                  {integration.name}
                  {!integration.active && <Badge variant="secondary">Inactive</Badge>}
                </CardTitle>
                <CardDescription>
                  Cloudflare · {integration.config.mode.toUpperCase()} · {
                    integration.config.scope === 'all-master' ? 'all Master zones'
                    : integration.config.scope === 'groups' ? `groups: ${integration.config.groups.join(', ') || '—'}`
                    : `${integration.config.zones.length} selected zone(s)`
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2 pt-0" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" onClick={() => handleTest(integration)}>Test</Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(integration)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(integration)} aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="ml-auto">
                  <Switch checked={integration.active} onCheckedChange={() => handleToggleActive(integration)} aria-label="Active" />
                </div>
              </CardContent>
              {testResult?.id === integration.id && (
                <CardContent className="pt-0">
                  <p className={`text-xs flex items-center gap-1 ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                    {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {testResult.message}
                  </p>
                </CardContent>
              )}
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
            {detail.zones.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No zone tracked yet — run a sync to provision every Master zone in scope at Cloudflare
              </p>
            ) : (
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
                  {detail.zones.map((zone) => (
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
            <div className="rounded-lg border border-dashed p-3 flex items-center justify-center">
              <p className="text-xs text-muted-foreground text-center">More providers coming<br />(open source — contribute!)</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="int-name">Name</Label>
              <Input id="int-name" placeholder="Cloudflare production" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
            <Button type="button" onClick={handleSave} disabled={isSaving || !form.name.trim() || (!editing && !form.apiToken.trim())}>
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
