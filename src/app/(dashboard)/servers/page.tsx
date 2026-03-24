'use client';

import * as React from 'react';
import { Plus, Server, Trash2, Edit2, Check, X, TestTube, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useServerConnectionStore } from '@/stores';
import * as api from '@/lib/api';
import type { ServerConnection } from '@/types/powerdns';

export default function ServersPage() {
  const { connections, activeConnection, addConnection, updateConnection, removeConnection, setActiveConnection } = useServerConnectionStore();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState({ name: '', url: '', apiKey: '', isDefault: false });
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateConnection(editingId, {
        ...formData,
        version: testResult?.success ? testResult.message.match(/v([\d.]+)/)?.[1] : undefined,
      });
    } else {
      addConnection({
        ...formData,
        version: testResult?.success ? testResult.message.match(/v([\d.]+)/)?.[1] : undefined,
      });
    }
    setDialogOpen(false);
    resetForm();
  };

  const handleEdit = (conn: ServerConnection) => {
    setEditingId(conn.id);
    setFormData({ name: conn.name, url: conn.url, apiKey: conn.apiKey, isDefault: conn.isDefault });
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to remove this server connection?')) {
      removeConnection(id);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({ name: '', url: '', apiKey: '', isDefault: false });
    setTestResult(null);
  };

  const testConnection = async () => {
    setTestResult(null);
    setIsTesting(true);
    try {
      const result = await api.testConnection(formData.url, formData.apiKey);
      if (result.data) {
        setTestResult(result.data);
      } else {
        setTestResult({ success: false, message: result.error || 'Unknown error' });
      }
    } catch {
      setTestResult({ success: false, message: 'Failed to connect to the server' });
    }
    setIsTesting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Server Connections</h1>
          <p className="text-muted-foreground">Manage your PowerDNS server connections</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Server' : 'Add Server Connection'}</DialogTitle>
              <DialogDescription>Configure the connection to your PowerDNS API server.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Connection Name</Label>
                <Input
                  id="name"
                  placeholder="Production Server"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">API URL</Label>
                <Input
                  id="url"
                  placeholder="http://localhost:8081"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="Your API key"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  required
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <Label htmlFor="isDefault">Set as Default</Label>
                  <p className="text-sm text-muted-foreground">Use this connection by default</p>
                </div>
                <Switch
                  id="isDefault"
                  checked={formData.isDefault}
                  onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
                />
              </div>

              {testResult && (
                <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-50 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
                  <div className="flex items-center gap-2">
                    {testResult.success ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    {testResult.message}
                  </div>
                </div>
              )}

              <DialogFooter className="flex gap-2">
                <Button type="button" variant="outline" onClick={testConnection} disabled={!formData.url || !formData.apiKey || isTesting}>
                  {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
                  Test Connection
                </Button>
                <Button type="submit">{editingId ? 'Update' : 'Add'} Server</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No Servers Connected</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-2">
              Add a PowerDNS server connection to start managing your DNS zones and records.
            </p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Server
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <Card key={conn.id} className={activeConnection?.id === conn.id ? 'border-primary' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    {conn.name}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {conn.isDefault && <Badge variant="secondary">Default</Badge>}
                    {activeConnection?.id === conn.id && <Badge variant="default">Active</Badge>}
                  </div>
                </div>
                <CardDescription className="font-mono text-xs">{conn.url}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {conn.version ? `v${conn.version}` : 'Version unknown'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setActiveConnection(conn.id)}
                      disabled={activeConnection?.id === conn.id}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(conn)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(conn.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
