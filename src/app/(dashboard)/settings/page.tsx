'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useUIPreferencesStore, type ThemeColor } from '@/stores';
import { cn } from '@/lib/utils';

const themeColors: { value: ThemeColor; label: string; color: string }[] = [
  { value: 'blue', label: 'Blue', color: 'bg-blue-500' },
  { value: 'green', label: 'Green', color: 'bg-green-500' },
  { value: 'purple', label: 'Purple', color: 'bg-purple-500' },
  { value: 'orange', label: 'Orange', color: 'bg-orange-500' },
  { value: 'red', label: 'Red', color: 'bg-red-500' },
  { value: 'teal', label: 'Teal', color: 'bg-teal-500' },
  { value: 'slate', label: 'Slate', color: 'bg-slate-500' },
  { value: 'rose', label: 'Rose', color: 'bg-rose-500' },
];

export default function SettingsPage() {
  const { theme, setTheme, themeColor, setThemeColor, recordsPerPage, setRecordsPerPage, zonesPerPage, setZonesPerPage, showDisabledRecords, setShowDisabledRecords, confirmDeletion, setConfirmDeletion, compactMode, setCompactMode } = useUIPreferencesStore();

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage application and authentication settings</p>
      </div>

      <Tabs defaultValue="appearance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="display">Display</TabsTrigger>
          <TabsTrigger value="ldap">LDAP Authentication</TabsTrigger>
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
              <Separator />
              <div>
                <Label>Accent Color</Label>
                <p className="text-sm text-muted-foreground mb-3">Choose your preferred accent color</p>
                <div className="flex flex-wrap gap-2">
                  {themeColors.map((c) => (
                    <button key={c.value} onClick={() => setThemeColor(c.value)} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all', themeColor === c.value ? 'border-primary bg-muted' : 'border-transparent hover:bg-muted')}>
                      <div className={cn('w-4 h-4 rounded-full', c.color)} />
                      <span className="text-sm">{c.label}</span>
                    </button>
                  ))}
                </div>
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
                <Select value={zonesPerPage.toString()} onValueChange={(v) => setZonesPerPage(parseInt(v))}>
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
                <Select value={recordsPerPage.toString()} onValueChange={(v) => setRecordsPerPage(parseInt(v))}>
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
                  <div className="flex gap-2">
                    <Button>Save Configuration</Button>
                    <Button variant="outline">Test Connection</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
