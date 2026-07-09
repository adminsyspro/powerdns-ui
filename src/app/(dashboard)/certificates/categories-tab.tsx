'use client';

import * as React from 'react';
import { Loader2, Plus, Pencil, Trash2, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/use-confirm';
import * as api from '@/lib/api';
import type { CertificateCategoryResponse } from '@/lib/api';

export function CategoriesTab({ onChange }: { onChange?: () => void }) {
  const [categories, setCategories] = React.useState<CertificateCategoryResponse[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CertificateCategoryResponse | null>(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [dialogError, setDialogError] = React.useState('');
  const { confirm, ConfirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    const r = await api.fetchCertCategories();
    if (r.data) setCategories(r.data);
    else setError(r.error ?? 'Failed to load categories');
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setName('');
    setDescription('');
    setDialogError('');
    setDialogOpen(true);
  }

  function openEdit(cat: CertificateCategoryResponse) {
    setEditing(cat);
    setName(cat.name);
    setDescription(cat.description);
    setDialogError('');
    setDialogOpen(true);
  }

  async function onSave() {
    if (!name.trim()) { setDialogError('Name is required'); return; }
    setSaving(true);
    setDialogError('');
    const r = editing
      ? await api.updateCertCategory(editing.id, { name: name.trim(), description: description.trim() })
      : await api.createCertCategory({ name: name.trim(), description: description.trim() });
    setSaving(false);
    if (r.error) { setDialogError(r.error); return; }
    setDialogOpen(false);
    load();
    onChange?.();
  }

  async function onDelete(cat: CertificateCategoryResponse) {
    const ok = await confirm({
      title: `Delete "${cat.name}"?`,
      description: 'This category must not be used by any certificate.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    setError('');
    const r = await api.deleteCertCategory(cat.id);
    if (r.error) { setError(r.error); return; }
    load();
    onChange?.();
  }

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" />Certificate Categories</CardTitle>
              <CardDescription>Organise certificates by business group. Each category maps to a folder in Infisical and on the filesystem.</CardDescription>
            </div>
            <Button size="sm" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Category</Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive mb-4">{error}</div>}
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No categories yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell className="text-muted-foreground">{cat.description || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(cat)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(cat)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Category' : 'New Category'}</DialogTitle>
          </DialogHeader>
          {dialogError && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{dialogError}</div>}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ecommerce" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea id="cat-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this group covers" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={onSave} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
}
