'use client';

import * as React from 'react';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useUIPreferencesStore } from '@/stores';
import * as api from '@/lib/api';
import { PageTitle } from '@/components/layout/page-title';
import { normalizeNameserverPools } from '@/lib/ns-pools';
import type { NameserverPool } from '@/lib/ns-pools';

interface OidcConfig {
  enabled: boolean;
  providerName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimEmail: string;
  claimName: string;
  claimGroups: string;
  autoProvision: boolean;
  defaultRole: string;
  requireAppGroupMatch: boolean;
  groupRoleMapping: string;
  groupAppGroupsMapping: string;
  showLocalLogin: boolean;
  forceSsoRedirect: boolean;
  appBaseUrl: string;
  hasClientSecret?: boolean;
  callbackUrl?: string;
}

export default function SettingsPage() {
  const { theme, setTheme, recordsPerPage, setRecordsPerPage, zonesPerPage, setZonesPerPage, showDisabledRecords, setShowDisabledRecords, confirmDeletion, setConfirmDeletion, compactMode, setCompactMode } = useUIPreferencesStore();

  const [ldapConfig, setLdapConfig] = React.useState({
    enabled: false,
    url: '',
    baseDN: '',
    bindDN: '',
    bindPassword: '',
    userFilter: '(uid={{username}})',
    adminGroup: 'pdns-admins',
    operatorGroup: 'pdns-operators',
  });
  const [ldapSaving, setLdapSaving] = React.useState(false);
  const [ldapMessage, setLdapMessage] = React.useState('');

  const [oidcConfig, setOidcConfig] = React.useState<OidcConfig>({
    enabled: false,
    providerName: '',
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    scopes: 'openid profile email groups',
    claimEmail: 'email',
    claimName: 'name',
    claimGroups: 'groups',
    autoProvision: false,
    defaultRole: 'User',
    requireAppGroupMatch: false,
    groupRoleMapping: '{}',
    groupAppGroupsMapping: '{}',
    showLocalLogin: true,
    forceSsoRedirect: false,
    appBaseUrl: '',
    hasClientSecret: false,
  });
  const [oidcSaving, setOidcSaving] = React.useState(false);
  const [oidcMessage, setOidcMessage] = React.useState('');
  const [oidcGroupRoleMappingError, setOidcGroupRoleMappingError] = React.useState('');
  const [oidcGroupAppGroupsMappingError, setOidcGroupAppGroupsMappingError] = React.useState('');
  const [oidcTestResult, setOidcTestResult] = React.useState('');
  const [oidcTesting, setOidcTesting] = React.useState(false);
  const [oidcCallbackCopied, setOidcCallbackCopied] = React.useState(false);

  // Redirect URI to register in the IdP. Previews the typed override live;
  // otherwise shows the server-effective value (env/host), then this browser's
  // origin as a last resort.
  const oidcCallbackUrl = React.useMemo(() => {
    const override = oidcConfig.appBaseUrl?.trim();
    if (override) {
      // Mirror the server: it stores only the origin (drops userinfo/path), so
      // preview from the origin to keep the copied URI identical to redirect_uri.
      try { return new URL('/api/auth/oidc/callback', new URL(override).origin).toString(); } catch { /* keep typing */ }
    }
    if (oidcConfig.callbackUrl) return oidcConfig.callbackUrl;
    if (typeof window !== 'undefined') return `${window.location.origin}/api/auth/oidc/callback`;
    return '';
  }, [oidcConfig.appBaseUrl, oidcConfig.callbackUrl]);

  const [nameserverPools, setNameserverPools] = React.useState<NameserverPool[]>([]);
  const [nameserverPoolsSaving, setNameserverPoolsSaving] = React.useState(false);
  const [nameserverPoolsMessage, setNameserverPoolsMessage] = React.useState('');

  React.useEffect(() => {
    fetch('/api/settings/ldap')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setLdapConfig(data); });
    fetch('/api/settings/oidc')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setOidcConfig((prev) => ({
            ...prev,
            ...data,
            clientSecret: '',
            groupRoleMapping: typeof data.groupRoleMapping === 'object'
              ? JSON.stringify(data.groupRoleMapping, null, 2)
              : (data.groupRoleMapping ?? '{}'),
            groupAppGroupsMapping: typeof data.groupAppGroupsMapping === 'object'
              ? JSON.stringify(data.groupAppGroupsMapping, null, 2)
              : (data.groupAppGroupsMapping ?? '{}'),
          }));
        }
      });
    api.fetchNameserverPools().then((result) => {
      if (!result.error) setNameserverPools(result.data?.pools || []);
    });
  }, []);

  const handleSaveOidc = async () => {
    setOidcMessage('');
    setOidcGroupRoleMappingError('');
    setOidcGroupAppGroupsMappingError('');

    let parsedGroupRoleMapping: unknown;
    let parsedGroupAppGroupsMapping: unknown;

    try {
      parsedGroupRoleMapping = JSON.parse(oidcConfig.groupRoleMapping || '{}');
    } catch {
      setOidcGroupRoleMappingError('Invalid JSON in Group Role Mapping.');
      return;
    }
    try {
      parsedGroupAppGroupsMapping = JSON.parse(oidcConfig.groupAppGroupsMapping || '{}');
    } catch {
      setOidcGroupAppGroupsMappingError('Invalid JSON in Group App-Groups Mapping.');
      return;
    }

    setOidcSaving(true);
    const body: Record<string, unknown> = {
      enabled: oidcConfig.enabled,
      providerName: oidcConfig.providerName,
      issuerUrl: oidcConfig.issuerUrl,
      clientId: oidcConfig.clientId,
      scopes: oidcConfig.scopes,
      claimEmail: oidcConfig.claimEmail,
      claimName: oidcConfig.claimName,
      claimGroups: oidcConfig.claimGroups,
      autoProvision: oidcConfig.autoProvision,
      defaultRole: oidcConfig.defaultRole,
      requireAppGroupMatch: oidcConfig.requireAppGroupMatch,
      groupRoleMapping: parsedGroupRoleMapping,
      groupAppGroupsMapping: parsedGroupAppGroupsMapping,
      showLocalLogin: oidcConfig.showLocalLogin,
      forceSsoRedirect: oidcConfig.forceSsoRedirect,
      appBaseUrl: oidcConfig.appBaseUrl,
    };
    if (oidcConfig.clientSecret) {
      body.clientSecret = oidcConfig.clientSecret;
    }
    const res = await fetch('/api/settings/oidc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setOidcSaving(false);
    if (res.ok) {
      setOidcMessage('Configuration saved.');
      // Refresh the server-effective callback URL (reflects the just-saved override).
      const refreshed = await fetch('/api/settings/oidc').then((r) => r.ok ? r.json() : null).catch(() => null);
      setOidcConfig((prev) => ({
        ...prev,
        clientSecret: '',
        hasClientSecret: prev.hasClientSecret || !!prev.clientSecret,
        callbackUrl: refreshed?.callbackUrl ?? prev.callbackUrl,
        // Reflect the *stored* (normalized) mappings so the user immediately sees
        // what was actually persisted — e.g. entries dropped for being malformed —
        // instead of stale textarea contents that look saved but weren't.
        groupRoleMapping: refreshed && typeof refreshed.groupRoleMapping === 'object'
          ? JSON.stringify(refreshed.groupRoleMapping, null, 2)
          : prev.groupRoleMapping,
        groupAppGroupsMapping: refreshed && typeof refreshed.groupAppGroupsMapping === 'object'
          ? JSON.stringify(refreshed.groupAppGroupsMapping, null, 2)
          : prev.groupAppGroupsMapping,
      }));
    } else {
      const data = await res.json().catch(() => ({}));
      setOidcMessage(data.error ? `Error: ${data.error}` : 'Error saving configuration.');
    }
  };

  const handleTestOidcDiscovery = async () => {
    setOidcTestResult('');
    setOidcTesting(true);
    try {
      const res = await fetch('/api/settings/oidc/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issuerUrl: oidcConfig.issuerUrl, clientId: oidcConfig.clientId }),
      });
      const data = await res.json();
      if (data.success) {
        setOidcTestResult(`Discovery OK — authorization_endpoint: ${data.authorization_endpoint} | token_endpoint: ${data.token_endpoint}`);
      } else {
        setOidcTestResult(`Discovery failed: ${data.error}`);
      }
    } catch {
      setOidcTestResult('Discovery failed: network error');
    } finally {
      setOidcTesting(false);
    }
  };

  const handleSaveLdap = async () => {
    setLdapSaving(true);
    setLdapMessage('');
    const res = await fetch('/api/settings/ldap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ldapConfig),
    });
    setLdapSaving(false);
    setLdapMessage(res.ok ? 'Configuration saved.' : 'Error saving configuration.');
  };

  const addNameserverPool = () => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `ns-pool-${Date.now()}`;
    setNameserverPools((pools) => [
      ...pools,
      {
        id,
        name: '',
        nameservers: [''],
        isDefault: pools.length === 0,
      },
    ]);
    setNameserverPoolsMessage('');
  };

  const updateNameserverPool = (id: string, patch: Partial<NameserverPool>) => {
    setNameserverPools((pools) => pools.map((pool) => (pool.id === id ? { ...pool, ...patch } : pool)));
    setNameserverPoolsMessage('');
  };

  const setDefaultNameserverPool = (id: string) => {
    setNameserverPools((pools) => pools.map((pool) => ({ ...pool, isDefault: pool.id === id })));
    setNameserverPoolsMessage('');
  };

  const deleteNameserverPool = (id: string) => {
    setNameserverPools((pools) => {
      const next = pools.filter((pool) => pool.id !== id);
      if (next.length > 0 && !next.some((pool) => pool.isDefault)) {
        return next.map((pool, index) => ({ ...pool, isDefault: index === 0 }));
      }
      return next;
    });
    setNameserverPoolsMessage('');
  };

  const handleSaveNameserverPools = async () => {
    setNameserverPoolsSaving(true);
    setNameserverPoolsMessage('');
    const normalizedPools = normalizeNameserverPools(nameserverPools);
    const result = await api.saveNameserverPools(normalizedPools);
    setNameserverPoolsSaving(false);
    if (result.error) {
      setNameserverPoolsMessage('Error saving nameserver pools.');
      return;
    }
    setNameserverPools(result.data?.pools || []);
    setNameserverPoolsMessage('Nameserver pools saved.');
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Settings" />

      <Tabs defaultValue="appearance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="display">Display</TabsTrigger>
          <TabsTrigger value="nameservers">Nameservers</TabsTrigger>
          <TabsTrigger value="ldap">LDAP Authentication</TabsTrigger>
          <TabsTrigger value="oidc">SSO / OIDC</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Theme</CardTitle><CardDescription>Customize the look and feel</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div><Label>Color Mode</Label><p className="text-sm text-muted-foreground">Select light, dark or system theme</p></div>
                <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
                  <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="display" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Display Options</CardTitle><CardDescription>Configure how data is displayed</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div><Label>Compact Mode</Label><p className="text-sm text-muted-foreground">Use smaller row heights in tables</p></div>
                <Switch checked={compactMode} onCheckedChange={setCompactMode} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div><Label>Zones per page</Label><p className="text-sm text-muted-foreground">Number of zones to display</p></div>
                <Select value={zonesPerPage.toString()} onValueChange={(v) => setZonesPerPage(Number.parseInt(v))}>
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div><Label>Records per page</Label><p className="text-sm text-muted-foreground">Number of records to display</p></div>
                <Select value={recordsPerPage.toString()} onValueChange={(v) => setRecordsPerPage(Number.parseInt(v))}>
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div><Label>Show disabled records</Label><p className="text-sm text-muted-foreground">Display disabled records in zone view</p></div>
                <Switch checked={showDisabledRecords} onCheckedChange={setShowDisabledRecords} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div><Label>Confirm deletions</Label><p className="text-sm text-muted-foreground">Show confirmation before deleting</p></div>
                <Switch checked={confirmDeletion} onCheckedChange={setConfirmDeletion} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nameservers" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Nameserver Pools</CardTitle>
                  <CardDescription>Configure reusable NS sets for new zone creation</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addNameserverPool}>
                  <Plus className="mr-2 h-4 w-4" />Add pool
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {nameserverPools.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No nameserver pools configured.
                </div>
              ) : (
                nameserverPools.map((pool) => (
                  <div key={pool.id} className="space-y-3 rounded-md border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="space-y-2 sm:flex-1">
                        <Label htmlFor={`ns-pool-name-${pool.id}`}>Pool name</Label>
                        <Input
                          id={`ns-pool-name-${pool.id}`}
                          placeholder="Production DNS"
                          value={pool.name}
                          onChange={(e) => updateNameserverPool(pool.id, { name: e.target.value })}
                        />
                      </div>
                      <div className="flex gap-2 sm:pt-8">
                        <Button
                          type="button"
                          variant={pool.isDefault ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setDefaultNameserverPool(pool.id)}
                        >
                          <Star className="mr-2 h-4 w-4" />Default
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteNameserverPool(pool.id)}
                          aria-label="Delete nameserver pool"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`ns-pool-values-${pool.id}`}>Nameservers</Label>
                      <Textarea
                        id={`ns-pool-values-${pool.id}`}
                        className="font-mono text-sm"
                        rows={Math.max(3, pool.nameservers.length)}
                        placeholder={'ns1.example.net.\nns2.example.net.'}
                        value={pool.nameservers.join('\n')}
                        onChange={(e) => updateNameserverPool(pool.id, { nameservers: e.target.value.split(/\r?\n/) })}
                      />
                    </div>
                  </div>
                ))
              )}

              {nameserverPoolsMessage && (
                <div className={`p-3 rounded-lg text-sm ${nameserverPoolsMessage.includes('Error') ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                  {nameserverPoolsMessage}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSaveNameserverPools} disabled={nameserverPoolsSaving}>
                  {nameserverPoolsSaving ? 'Saving...' : 'Save Nameserver Pools'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ldap" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>LDAP Configuration</CardTitle><CardDescription>Configure LDAP/Active Directory authentication</CardDescription></div>
                <Badge variant={ldapConfig.enabled ? 'success' : 'secondary'}>{ldapConfig.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div><Label>Enable LDAP</Label><p className="text-sm text-muted-foreground">Use LDAP for user authentication</p></div>
                <Switch checked={ldapConfig.enabled} onCheckedChange={(v) => setLdapConfig({ ...ldapConfig, enabled: v })} />
              </div>

              {ldapConfig.enabled && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>LDAP Server URL</Label>
                      <Input placeholder="ldap://ldap.example.com:389" value={ldapConfig.url} onChange={(e) => setLdapConfig({ ...ldapConfig, url: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Base DN</Label>
                      <Input placeholder="dc=example,dc=com" value={ldapConfig.baseDN} onChange={(e) => setLdapConfig({ ...ldapConfig, baseDN: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Bind DN (optional)</Label>
                      <Input placeholder="cn=admin,dc=example,dc=com" value={ldapConfig.bindDN} onChange={(e) => setLdapConfig({ ...ldapConfig, bindDN: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Bind Password</Label>
                      <Input type="password" value={ldapConfig.bindPassword} onChange={(e) => setLdapConfig({ ...ldapConfig, bindPassword: e.target.value })} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>User Search Filter</Label>
                      <Input placeholder="(uid={{username}})" value={ldapConfig.userFilter} onChange={(e) => setLdapConfig({ ...ldapConfig, userFilter: e.target.value })} />
                      <p className="text-xs text-muted-foreground">Use {'{{username}}'} as placeholder for the login username</p>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-3">Group Mapping</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Administrator Group</Label>
                        <Input placeholder="pdns-admins" value={ldapConfig.adminGroup} onChange={(e) => setLdapConfig({ ...ldapConfig, adminGroup: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Operator Group</Label>
                        <Input placeholder="pdns-operators" value={ldapConfig.operatorGroup} onChange={(e) => setLdapConfig({ ...ldapConfig, operatorGroup: e.target.value })} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Users not in these groups will have read-only access</p>
                  </div>
                  {ldapMessage && (
                    <div className={`p-3 rounded-lg text-sm ${ldapMessage.includes('Error') ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                      {ldapMessage}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={handleSaveLdap} disabled={ldapSaving}>
                      {ldapSaving ? 'Saving...' : 'Save Configuration'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oidc" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>SSO / OIDC Configuration</CardTitle><CardDescription>Configure OpenID Connect single sign-on</CardDescription></div>
                <Badge variant={oidcConfig.enabled ? 'success' : 'secondary'}>{oidcConfig.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div><Label>Enable SSO / OIDC</Label><p className="text-sm text-muted-foreground">Use OIDC for single sign-on</p></div>
                <Switch checked={oidcConfig.enabled} onCheckedChange={(v) => setOidcConfig({ ...oidcConfig, enabled: v })} />
              </div>

              {oidcConfig.enabled && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Provider Name</Label>
                      <Input placeholder="Keycloak" value={oidcConfig.providerName} onChange={(e) => setOidcConfig({ ...oidcConfig, providerName: e.target.value })} />
                      <p className="text-xs text-muted-foreground">Shown on the login button: &ldquo;Continue with &hellip;&rdquo;</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Issuer URL</Label>
                      <Input placeholder="https://keycloak.example.com/realms/myrealm" value={oidcConfig.issuerUrl} onChange={(e) => setOidcConfig({ ...oidcConfig, issuerUrl: e.target.value })} />
                      <p className="text-xs text-muted-foreground">IdP base URL; discovery via /.well-known/openid-configuration</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input placeholder="powerdns-ui" value={oidcConfig.clientId} onChange={(e) => setOidcConfig({ ...oidcConfig, clientId: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <Input
                        type="password"
                        placeholder={oidcConfig.hasClientSecret ? '•••••• (configured)' : ''}
                        value={oidcConfig.clientSecret}
                        onChange={(e) => setOidcConfig({ ...oidcConfig, clientSecret: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Leave blank to keep the existing secret</p>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Scopes</Label>
                      <Input placeholder="openid profile email groups" value={oidcConfig.scopes} onChange={(e) => setOidcConfig({ ...oidcConfig, scopes: e.target.value })} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Application URL</Label>
                      <Input placeholder="https://dns.example.com" value={oidcConfig.appBaseUrl} onChange={(e) => setOidcConfig({ ...oidcConfig, appBaseUrl: e.target.value })} />
                      <p className="text-xs text-muted-foreground">Public URL users reach this app on. Required behind a reverse proxy so the redirect URI isn&apos;t built from the internal address. Leave blank to use the APP_URL env var or the request host.</p>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Redirect URI</Label>
                      <div className="flex gap-2">
                        <Input readOnly className="font-mono text-sm" value={oidcCallbackUrl} onFocus={(e) => e.target.select()} />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!oidcCallbackUrl}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(oidcCallbackUrl);
                              setOidcCallbackCopied(true);
                              setTimeout(() => setOidcCallbackCopied(false), 1500);
                            } catch { /* clipboard unavailable */ }
                          }}
                        >
                          {oidcCallbackCopied ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Register this exact URI in your IdP&apos;s allowed redirect URIs.</p>
                    </div>
                  </div>

                  <div className="flex gap-2 items-center">
                    <Button type="button" variant="outline" size="sm" onClick={handleTestOidcDiscovery} disabled={oidcTesting || !oidcConfig.issuerUrl}>
                      {oidcTesting ? 'Testing...' : 'Test discovery'}
                    </Button>
                    {oidcTestResult && (
                      <span className={`text-xs ${oidcTestResult.includes('failed') ? 'text-destructive' : 'text-green-700 dark:text-green-400'}`}>
                        {oidcTestResult}
                      </span>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-3">Token Claims</h4>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Email claim</Label>
                        <Input placeholder="email" value={oidcConfig.claimEmail} onChange={(e) => setOidcConfig({ ...oidcConfig, claimEmail: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Name claim</Label>
                        <Input placeholder="name" value={oidcConfig.claimName} onChange={(e) => setOidcConfig({ ...oidcConfig, claimName: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Groups claim</Label>
                        <Input placeholder="groups" value={oidcConfig.claimGroups} onChange={(e) => setOidcConfig({ ...oidcConfig, claimGroups: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-3">Provisioning</h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div><Label>Auto-provision users</Label><p className="text-sm text-muted-foreground">Create accounts for new SSO users automatically</p></div>
                        <Switch checked={oidcConfig.autoProvision} onCheckedChange={(v) => setOidcConfig({ ...oidcConfig, autoProvision: v })} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div><Label>Default role</Label><p className="text-sm text-muted-foreground">Role assigned to auto-provisioned users with no group match</p></div>
                        <Select value={oidcConfig.defaultRole} onValueChange={(v) => setOidcConfig({ ...oidcConfig, defaultRole: v })}>
                          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Administrator">Administrator</SelectItem>
                            <SelectItem value="Operator">Operator</SelectItem>
                            <SelectItem value="Manager">Manager</SelectItem>
                            <SelectItem value="User">User</SelectItem>
                            <SelectItem value="Customer">Customer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <div><Label>Require app-group match</Label><p className="text-sm text-muted-foreground">Block login if user has no matching app-groups mapping entry</p></div>
                        <Switch checked={oidcConfig.requireAppGroupMatch} onCheckedChange={(v) => setOidcConfig({ ...oidcConfig, requireAppGroupMatch: v })} />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-3">Group Mappings</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Group → Role mapping (JSON)</Label>
                        <Textarea
                          className="font-mono text-sm"
                          rows={4}
                          placeholder={'{\n  "keycloak-admins": "Administrator"\n}'}
                          value={oidcConfig.groupRoleMapping}
                          onChange={(e) => { setOidcConfig({ ...oidcConfig, groupRoleMapping: e.target.value }); setOidcGroupRoleMappingError(''); }}
                        />
                        {oidcGroupRoleMappingError && <p className="text-xs text-destructive">{oidcGroupRoleMappingError}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Group → App-groups mapping (JSON)</Label>
                        <Textarea
                          className="font-mono text-sm"
                          rows={4}
                          placeholder={'{\n  "acme-team": ["acme"]\n}'}
                          value={oidcConfig.groupAppGroupsMapping}
                          onChange={(e) => { setOidcConfig({ ...oidcConfig, groupAppGroupsMapping: e.target.value }); setOidcGroupAppGroupsMappingError(''); }}
                        />
                        {oidcGroupAppGroupsMappingError && <p className="text-xs text-destructive">{oidcGroupAppGroupsMappingError}</p>}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-3">Login page behaviour</h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div><Label>Show local login form</Label><p className="text-sm text-muted-foreground">Display username/password form alongside the SSO button</p></div>
                        <Switch checked={oidcConfig.showLocalLogin} onCheckedChange={(v) => setOidcConfig({ ...oidcConfig, showLocalLogin: v })} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div><Label>Force SSO redirect</Label><p className="text-sm text-muted-foreground">Redirect to SSO automatically on login page load (use ?local=1 to bypass)</p></div>
                        <Switch checked={oidcConfig.forceSsoRedirect} onCheckedChange={(v) => setOidcConfig({ ...oidcConfig, forceSsoRedirect: v })} />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {oidcMessage && (
                <div className={`p-3 rounded-lg text-sm ${oidcMessage.includes('Error') ? 'bg-destructive/10 text-destructive' : 'bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                  {oidcMessage}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSaveOidc} disabled={oidcSaving}>
                  {oidcSaving ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
