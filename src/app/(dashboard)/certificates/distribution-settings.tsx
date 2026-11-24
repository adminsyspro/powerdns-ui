'use client';

import * as React from 'react';
import { Loader2, Check, AlertCircle, PlugZap, CloudUpload, Pencil, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/hooks/use-confirm';
import * as api from '@/lib/api';
import type { DistributionConnection, ProviderType } from '@/lib/certs/distribution/types';

type Msg = { ok: boolean; text: string } | null;

interface FormState {
  name: string;
  type: ProviderType;
  enabled: boolean;
  dir: string;
  siteUrl: string;
  clientId: string;
  secret: string;
  autoAttach: boolean;
  projectId: string;
  environment: string;
  path: string;
}

const EMPTY: FormState = {
  name: '', type: 'infisical-secrets', enabled: true, dir: '', siteUrl: '', clientId: '', secret: '',
  autoAttach: false, projectId: '', environment: 'prod', path: '/{category}/{name}',
};

function fromConnection(c: DistributionConnection): FormState {
  const cfg = c.config as Record<string, string>;
  const t = (c.defaultTarget ?? {}) as Record<string, string>;
  return {
    name: c.name, type: c.type, enabled: c.enabled, dir: cfg.dir ?? '', siteUrl: cfg.siteUrl ?? '',
    clientId: cfg.clientId ?? '', secret: '', autoAttach: c.autoAttach, projectId: t.projectId ?? '',
    environment: t.environment ?? 'prod', path: t.path ?? '/{category}/{name}',
  };
}

function toPayload(f: FormState, isNew: boolean): api.ConnectionPayload {
  const infisical = f.type === 'infisical-secrets';
  return {
    name: f.name,
    ...(isNew ? { type: f.type } : {}),
    enabled: f.enabled,
    config: infisical ? { siteUrl: f.siteUrl, clientId: f.clientId } : { dir: f.dir },
    ...(f.secret ? { secret: f.secret } : {}),
    autoAttach: f.autoAttach,
    ...(f.autoAttach ? { defaultTarget: infisical ? { projectId: f.projectId, environment: f.environment, path: f.path } : {} } : {}),
  };
}

function ConnectionForm({ initial, connectionId, hasSecret, onSaved, onCancel }: {
  initial: FormState; connectionId?: string; hasSecret: boolean;
  onSaved: (c: DistributionConnection) => void; onCancel: () => void;
}) {
  const isNew = !connectionId;
  const [f, setF] = React.useState<FormState>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const infisical = f.type === 'infisical-secrets';
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Infisical prod" />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={f.type} onValueChange={(v) => set('type', v as ProviderType)} disabled={!isNew}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="infisical-secrets">Infisical (secrets)</SelectItem>
              <SelectItem value="filesystem">Filesystem / NFS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {infisical ? (
          <>
            <div className="space-y-2">
              <Label>Server URL</Label>
              <Input placeholder="https://infisical.example.com" value={f.siteUrl} onChange={(e) => set('siteUrl', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client ID (Universal Auth)</Label>
              <Input value={f.clientId} onChange={(e) => set('clientId', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input type="password" value={f.secret} onChange={(e) => set('secret', e.target.value)}
                placeholder={hasSecret ? '••••••••  (unchanged)' : 'Machine identity client secret'} />
            </div>
          </>
        ) : (
          <div className="space-y-2 sm:col-span-2">
            <Label>Directory</Label>
            <Input placeholder="empty = CERTS_DIR" value={f.dir} onChange={(e) => set('dir', e.target.value)} />
            <p className="text-xs text-muted-foreground">Writes <code>&lt;dir&gt;/live/&lt;name&gt;/</code>. Group-shared (NFS) mode follows CERTS_GID / CERTS_UID.</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch id="cf-enabled" checked={f.enabled} onCheckedChange={(v) => set('enabled', v)} />
          <Label htmlFor="cf-enabled">Enabled</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="cf-auto" checked={f.autoAttach} onCheckedChange={(v) => set('autoAttach', v)} />
          <Label htmlFor="cf-auto">Apply to every certificate</Label>
        </div>
      </div>

      {f.autoAttach && infisical && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Default project ID</Label>
            <Input value={f.projectId} onChange={(e) => set('projectId', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Environment</Label>
            <Input value={f.environment} onChange={(e) => set('environment', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Path</Label>
            <Input value={f.path} onChange={(e) => set('path', e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Placeholders <code>{'{category}'}</code> and <code>{'{name}'}</code>. Changing this target moves every certificate:
            the old secrets are deleted after the new ones are written.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={async () => {
          setSaving(true); setError('');
          const r = isNew
            ? await api.createDistributionConnection(toPayload(f, true))
            : await api.updateDistributionConnection(connectionId!, toPayload(f, false));
          setSaving(false);
          if (r.error || !r.data) setError(r.error || 'save failed'); else onSaved(r.data);
        }}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isNew ? 'Create' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function describeTarget(c: DistributionConnection): string {
  if (!c.autoAttach) return 'per-certificate destinations only';
  if (c.type === 'filesystem') return `every certificate → ${(c.config as Record<string, string>).dir || 'CERTS_DIR'}/live/<name>`;
  const t = (c.defaultTarget ?? {}) as Record<string, string>;
  return `every certificate → ${t.projectId} / ${t.environment} : ${t.path}`;
}

export function DistributionSettings() {
  const [connections, setConnections] = React.useState<DistributionConnection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<string | null>(null); // connection id or 'new'
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [publishResult, setPublishResult] = React.useState<api.ReconcileSummaryResponse | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    const r = await api.fetchDistributionConnections();
    if (r.data) setConnections(r.data.connections);
    else if (r.error) setMsg({ ok: false, text: r.error });
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (c: DistributionConnection, enabled: boolean) => {
    const r = await api.updateDistributionConnection(c.id, { enabled });
    if (r.error) setMsg({ ok: false, text: r.error });
    load();
  };

  const test = async (c: DistributionConnection) => {
    setBusy(`test-${c.id}`); setMsg(null);
    const target = c.autoAttach && c.defaultTarget && c.type === 'infisical-secrets' ? c.defaultTarget : undefined;
    const r = await api.testDistributionConnection(c.id, target);
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    else setMsg({ ok: !!r.data?.ok, text: `${c.name}: ${r.data?.ok ? r.data.detail ?? 'OK' : r.data?.error}` });
  };

  const remove = async (c: DistributionConnection) => {
    const ok = await confirm({
      title: `Delete connection "${c.name}"?`,
      description: 'Everything this connection published (certificates and private keys) is deleted from the destination first, then the connection is removed.',
      confirmLabel: 'Delete', variant: 'destructive',
    });
    if (!ok) return;
    setBusy(`rm-${c.id}`);
    const r = await api.deleteDistributionConnection(c.id);
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    load();
  };

  const publishAll = async (force: boolean) => {
    setBusy(force ? 'pub-force' : 'pub'); setPublishResult(null);
    const r = await api.publishAllCertsApi(force);
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error }); else setPublishResult(r.data ?? null);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Distribution connections</CardTitle>
            <CardDescription>
              Where issued certificates are published. A connection applied to every certificate is the default;
              others are added per certificate (e.g. one Infisical project per consumer).
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}><Plus className="mr-2 h-4 w-4" />Add connection</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing === 'new' && (
            <ConnectionForm initial={EMPTY} hasSecret={false}
              onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
          )}
          {msg && (
            <div className={`flex items-center gap-2 text-sm ${msg.ok ? 'text-green-600' : 'text-destructive'}`}>
              {msg.ok ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{msg.text}
            </div>
          )}
          {connections.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              {editing === c.id ? (
                <ConnectionForm initial={fromConnection(c)} connectionId={c.id} hasSecret={c.hasSecret}
                  onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-medium">{c.name} <span className="ml-1 text-xs font-normal text-muted-foreground">{c.type}</span></div>
                    <div className="text-xs text-muted-foreground">
                      {c.type === 'infisical-secrets' && <>{(c.config as Record<string, string>).siteUrl} · secret {c.hasSecret ? 'set' : 'missing'} · </>}
                      {describeTarget(c)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={c.enabled} onCheckedChange={(v) => toggleEnabled(c, v)} aria-label="enabled" />
                    <Button variant="ghost" size="icon" title="Test (read-only)" onClick={() => test(c)} disabled={!!busy}>
                      {busy === `test-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditing(c.id)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(c)} disabled={!!busy || c.id === 'filesystem-default'}>
                      {busy === `rm-${c.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publish</CardTitle>
          <CardDescription>
            Out-of-date destinations are republished automatically every few minutes (failures retried with backoff).
            Use this to publish now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => publishAll(false)} disabled={!!busy}>
              {busy === 'pub' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
              Publish out-of-date
            </Button>
            <Button variant="ghost" onClick={() => publishAll(true)} disabled={!!busy}>
              {busy === 'pub-force' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Republish everything
            </Button>
          </div>
          {publishResult && (
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium text-green-600">{publishResult.published} published</span>
                {publishResult.failed > 0 && <>, <span className="font-medium text-destructive">{publishResult.failed} failed</span></>}
              </p>
              <ul className="space-y-1 text-destructive">
                {publishResult.outcomes.filter((o) => o.action === 'failed').map((o) => (
                  <li key={o.distributionId}>{o.connectionName}: {o.error}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog />
    </div>
  );
}
