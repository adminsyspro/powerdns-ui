'use client';

import * as React from 'react';
import { Plus, Copy, Trash2, Key, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate, copyToClipboard } from '@/lib/utils';
import type { ApiKey, UserRole } from '@/types/powerdns';

const mockApiKeys: ApiKey[] = [
  { id: '1', key: 'pdns_sk_live_abcd1234efgh5678', description: 'Production API', domains: ['*'], role: 'Administrator', created_at: new Date('2024-01-01') },
  { id: '2', key: 'pdns_sk_live_ijkl9012mnop3456', description: 'CI/CD Pipeline', domains: ['example.com', 'test.org'], role: 'Operator', created_at: new Date('2024-02-01') },
  { id: '3', key: 'pdns_sk_live_qrst7890uvwx1234', description: 'Monitoring', domains: ['*'], role: 'User', created_at: new Date('2024-03-01') },
];

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = React.useState<ApiKey[]>(mockApiKeys);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [newKeyShown, setNewKeyShown] = React.useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = React.useState<Set<string>>(new Set());
  const [formData, setFormData] = React.useState({ description: '', role: 'User' as UserRole, domains: '' });

  const generateKey = () => `pdns_sk_live_${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const newKey = generateKey();
    const domains = formData.domains.split(',').map(d => d.trim()).filter(Boolean);
    setApiKeys([...apiKeys, { id: Date.now().toString(), key: newKey, description: formData.description, domains: domains.length ? domains : ['*'], role: formData.role, created_at: new Date() }]);
    setNewKeyShown(newKey);
    setFormData({ description: '', role: 'User', domains: '' });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure? This action cannot be undone.')) {
      setApiKeys(apiKeys.filter(k => k.id !== id));
    }
  };

  const toggleKeyVisibility = (id: string) => {
    const newSet = new Set(visibleKeys);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setVisibleKeys(newSet);
  };

  const maskKey = (key: string) => `${key.substring(0, 12)}${'•'.repeat(20)}${key.substring(key.length - 4)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground">Manage API keys for programmatic access</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setNewKeyShown(null); }}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Create API Key</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{newKeyShown ? 'API Key Created' : 'Create API Key'}</DialogTitle>
              <DialogDescription>{newKeyShown ? 'Copy your API key now. You won\'t be able to see it again.' : 'Create a new API key for programmatic access.'}</DialogDescription>
            </DialogHeader>
            {newKeyShown ? (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg font-mono text-sm break-all">{newKeyShown}</div>
                <Button className="w-full" onClick={() => { copyToClipboard(newKeyShown); }}><Copy className="mr-2 h-4 w-4" />Copy to Clipboard</Button>
                <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Done</Button></DialogFooter>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2"><Label>Description</Label><Input placeholder="What's this key for?" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Permission Level</Label>
                  <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v as UserRole })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Administrator">Administrator - Full access</SelectItem>
                      <SelectItem value="Operator">Operator - Create/Edit zones</SelectItem>
                      <SelectItem value="User">User - Read only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Allowed Domains (optional)</Label><Input placeholder="example.com, test.org (leave empty for all)" value={formData.domains} onChange={(e) => setFormData({ ...formData, domains: e.target.value })} /><p className="text-xs text-muted-foreground">Comma-separated list of domains this key can access</p></div>
                <DialogFooter><Button type="submit">Create Key</Button></DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Active API Keys</CardTitle><CardDescription>Keys that can be used to access the API</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead>Domains</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-2">
                      {visibleKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleKeyVisibility(apiKey.id)}>
                        {visibleKeys.has(apiKey.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>{apiKey.description}</TableCell>
                  <TableCell><Badge variant={apiKey.role === 'Administrator' ? 'default' : apiKey.role === 'Operator' ? 'secondary' : 'outline'}>{apiKey.role}</Badge></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{apiKey.domains.map(d => <Badge key={d} variant="outline" className="text-xs">{d}</Badge>)}</div></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(apiKey.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => copyToClipboard(apiKey.key)}><Copy className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(apiKey.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
