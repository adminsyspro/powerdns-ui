'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Edit2, Trash2, Loader2 } from 'lucide-react';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';

interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  zoneCount: number;
  createdAt: string;
  updatedAt: string;
}

const SLUG_RE = /^[a-z0-9-]+$/;

export default function GroupsPage() {
  const [groups, setGroups] = React.useState<GroupSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  // Create/Edit dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<GroupSummary | null>(null);
  const [formData, setFormData] = React.useState({ slug: '', name: '', description: '' });
  const [formError, setFormError] = React.useState('');
  const [slugError, setSlugError] = React.useState('');

  // Delete state
  const [deleteError, setDeleteError] = React.useState('');
  const [deleteNote, setDeleteNote] = React.useState('');
  const [deleteOpenSlug, setDeleteOpenSlug] = React.useState<string | null>(null);

  const fetchGroups = async () => {
    const res = await fetch('/api/groups');
    if (res.ok) {
      const data = await res.json();
      setGroups(data);
    }
    setIsLoading(false);
  };

  React.useEffect(() => { fetchGroups(); }, []);

  const openCreate = () => {
    setEditingGroup(null);
    setFormData({ slug: '', name: '', description: '' });
    setFormError('');
    setSlugError('');
    setDialogOpen(true);
  };

  const openEdit = (group: GroupSummary) => {
    setEditingGroup(group);
    setFormData({ slug: group.slug, name: group.name, description: group.description || '' });
    setFormError('');
    setSlugError('');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSlugError('');

    if (!editingGroup) {
      // Validate slug client-side
      if (!SLUG_RE.test(formData.slug)) {
        setSlugError('Only lowercase letters, digits, and dashes are allowed.');
        return;
      }
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: formData.slug, name: formData.name, description: formData.description }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          setSlugError('Slug already exists. Choose a different one.');
        } else {
          setFormError(data.error || 'An error occurred');
        }
        return;
      }
    } else {
      const res = await fetch(`/api/groups/${editingGroup.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, description: formData.description }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error || 'An error occurred');
        return;
      }
    }

    setDialogOpen(false);
    setEditingGroup(null);
    fetchGroups();
  };

  const handleDelete = async (group: GroupSummary) => {
    setDeleteError('');
    setDeleteNote('');
    const res = await fetch(`/api/groups/${group.slug}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setDeleteError(data.error || 'Failed to delete group');
      return;
    }
    const data = await res.json();
    if (data.orphanedZoneCount > 0) {
      setDeleteNote(`${data.orphanedZoneCount} zone${data.orphanedZoneCount > 1 ? 's' : ''} kept their account and are now admin-only-visible.`);
    }
    setDeleteOpenSlug(null);
    fetchGroups();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Groups" />
      <div className="flex items-center justify-end">
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) { setEditingGroup(null); setFormError(''); setSlugError(''); }
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Create Group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingGroup ? 'Edit Group' : 'Create Group'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>
              )}
              {editingGroup ? (
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input value={editingGroup.slug} disabled className="bg-muted text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Slug is immutable after creation.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input
                    value={formData.slug}
                    onChange={(e) => { setFormData({ ...formData, slug: e.target.value }); setSlugError(''); }}
                    placeholder="e.g. my-team"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Lowercase letters, digits, and dashes only (e.g. <code>my-team</code>).</p>
                  {slugError && <p className="text-xs text-destructive">{slugError}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Display name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button type="submit">{editingGroup ? 'Update' : 'Create'} Group</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {deleteNote && (
        <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 p-3 text-sm text-amber-800 dark:text-amber-200">
          {deleteNote}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Zones</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No groups yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-mono text-sm">
                    <Link href={`/groups/${group.slug}`} className="text-primary hover:underline">
                      {group.slug}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/groups/${group.slug}`} className="hover:underline">
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">
                    {group.description || <span className="italic">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{group.memberCount}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{group.zoneCount}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(group)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <AlertDialog open={deleteOpenSlug === group.slug} onOpenChange={(open) => { setDeleteOpenSlug(open ? group.slug : null); if (open) { setDeleteError(''); setDeleteNote(''); } }}>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete group</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete <span className="font-semibold">{group.name}</span>?
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          {deleteError && (
                            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{deleteError}</div>
                          )}
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={(e) => { e.preventDefault(); handleDelete(group); }}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
