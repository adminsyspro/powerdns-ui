'use client';

import * as React from 'react';
import { Loader2, Check, AlertCircle, RefreshCw, CloudUpload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import * as api from '@/lib/api';

export function InfisicalSettings() {
  const [config, setConfig] = React.useState<api.InfisicalConfigResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; error?: string } | null>(null);
  const [syncResult, setSyncResult] = React.useState<{ synced: number; failed: number; errors: Array<{ certId: string; name: string; error: string }> } | null>(null);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [enabled, setEnabled] = React.useState(false);
  const [siteUrl, setSiteUrl] = React.useState('');
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [environment, setEnvironment] = React.useState('production');
  const [secretBasePath, setSecretBasePath] = React.useState('/ssl');

  React.useEffect(() => {
    api.fetchInfisicalConfig().then((r) => {
      if (r.data) {
        setConfig(r.data);
        setEnabled(r.data.enabled);
        setSiteUrl(r.data.siteUrl);
        setClientId(r.data.clientId);
        setProjectId(r.data.projectId);
        setEnvironment(r.data.environment);
        setSecretBasePath(r.data.secretBasePath);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    setTestResult(null);
    const r = await api.saveInfisicalConfigApi({
      enabled, siteUrl, clientId,
      clientSecret: clientSecret || undefined,
      projectId, environment, secretBasePath,
    });
    if (r.data) {
      setConfig(r.data);
      setClientSecret('');
      setSuccess('Configuration saved');
    } else {
      setError(r.error || 'Failed to save');
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await api.testInfisicalApi();
    setTestResult(r.data ?? { ok: false, error: r.error || 'Unknown error' });
    setTesting(false);
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncResult(null);
    const r = await api.syncAllCertsApi();
    setSyncResult(r.data ?? null);
    setSyncing(false);
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Infisical Integration</CardTitle>
          <CardDescription>Push certificates to Infisical for distribution via the Infisical Agent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="infisical-enabled" />
            <Label htmlFor="infisical-enabled">Enable Infisical sync</Label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Server URL</Label>
              <Input placeholder="https://infisical.example.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Project ID</Label>
              <Input placeholder="project-id" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input placeholder="Machine Identity Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input
                type="password"
                placeholder={config?.hasClientSecret ? '••••••••  (unchanged)' : 'Machine Identity Client Secret'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Environment</Label>
              <Input placeholder="production" value={environment} onChange={(e) => setEnvironment(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Secret Base Path</Label>
              <Input placeholder="/ssl" value={secretBasePath} onChange={(e) => setSecretBasePath(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing || !config?.hasClientSecret}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
              {testResult.ok ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {testResult.ok ? 'Connection successful' : testResult.error}
            </div>
          )}
        </CardContent>
      </Card>

      {config?.enabled && config.hasClientSecret && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync Certificates</CardTitle>
            <CardDescription>Push all valid certificates to Infisical</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={handleSyncAll} disabled={syncing}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
              Sync All Certificates
            </Button>

            {syncResult && (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="text-green-600 font-medium">{syncResult.synced} synced</span>
                  {syncResult.failed > 0 && (
                    <>, <span className="text-destructive font-medium">{syncResult.failed} failed</span></>
                  )}
                </p>
                {syncResult.errors.length > 0 && (
                  <ul className="text-sm text-destructive space-y-1">
                    {syncResult.errors.map((e) => (
                      <li key={e.certId}>{e.name}: {e.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
