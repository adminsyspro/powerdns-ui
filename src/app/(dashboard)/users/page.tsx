'use client';

import * as React from 'react';
import { Plus, Edit2, Trash2, Loader2, UserCheck, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/utils';
import type { UserRole } from '@/types/powerdns';

interface UserData {
  id: string;
  username: string;
  email: string;
  firstname: string;
  lastname: string;
  role: UserRole;
  active: boolean;
  authType: string;
  created_at: string;
  updated_at: string;
}

interface GroupData {
  id: string;
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  zoneCount: number;
}

interface UserGroupMembership {
  slug: string;
  name: string;
  source: 'manual' | 'ldap' | 'oidc';
}

export default function UsersPage() {
  const [users, setUsers] = React.useState<UserData[]>([]);
  const [allGroups, setAllGroups] = React.useState<GroupData[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserData | null>(null);
  const [formData, setFormData] = React.useState({ username: '', email: '', firstname: '', lastname: '', role: 'User' as UserRole, password: '' });
  const [error, setError] = React.useState('');

  // Per-user groups loaded when the edit modal opens
  const [userGroups, setUserGroups] = React.useState<UserGroupMembership[]>([]);
  const [groupsLoading, setGroupsLoading] = React.useState(false);
  const [groupsError, setGroupsError] = React.useState('');
  const [selectedGroupSlugs, setSelectedGroupSlugs] = React.useState<Set<string>>(new Set());
  const [groupsSaving, setGroupsSaving] = React.useState(false);
  const [groupsSaveSuccess, setGroupsSaveSuccess] = React.useState(false);

  // Per-user group counts for the table column (slug sets keyed by user id)
  const [userGroupCounts, setUserGroupCounts] = React.useState<Record<string, number>>({});

  const fetchUsersAndGroups = async () => {
    const [usersRes, groupsRes] = await Promise.all([
      fetch('/api/users'),
      fetch('/api/groups'),
    ]);
    if (usersRes.ok) {
      const data: UserData[] = await usersRes.json();
      setUsers(data);
      // Fetch group counts for each user in parallel (one small request per user)
      const counts: Record<string, number> = {};
      await Promise.all(
        data.map(async (u) => {
          try {
            const r = await fetch(`/api/users/${u.id}/groups`);
            if (r.ok) {
              const memberships: UserGroupMembership[] = await r.json();
              counts[u.id] = memberships.length;
            }
          } catch {
            // silently ignore per-user fetch errors in the count pass
          }
        })
      );
      setUserGroupCounts(counts);
    }
    if (groupsRes.ok) {
      setAllGroups(await groupsRes.json());
    }
    setIsLoading(false);
  };

  React.useEffect(() => { fetchUsersAndGroups(); }, []);

  const fetchUserGroups = async (userId: string) => {
    setGroupsLoading(true);
    setGroupsError('');
    setGroupsSaveSuccess(false);
    try {
      const res = await fetch(`/api/users/${userId}/groups`);
      if (res.ok) {
        const memberships: UserGroupMembership[] = await res.json();
        setUserGroups(memberships);
        setSelectedGroupSlugs(new Set(memberships.filter((m) => m.source === 'manual').map((m) => m.slug)));
      } else {
        setGroupsError('Failed to load group memberships');
      }
    } catch {
      setGroupsError('Failed to load group memberships');
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
    const method = editingUser ? 'PUT' : 'POST';

    const body: Record<string, unknown> = { ...formData };
    if (editingUser && !formData.password) {
      delete body.password;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'An error occurred');
      return;
    }

    setDialogOpen(false);
    setEditingUser(null);
    setFormData({ username: '', email: '', firstname: '', lastname: '', role: 'User', password: '' });
    fetchUsersAndGroups();
  };

  const handleEdit = (user: UserData) => {
    setEditingUser(user);
    setFormData({ username: user.username, email: user.email, firstname: user.firstname || '', lastname: user.lastname || '', role: user.role, password: '' });
    setError('');
    setUserGroups([]);
    setSelectedGroupSlugs(new Set());
    setGroupsSaveSuccess(false);
    setGroupsError('');
    setDialogOpen(true);
    fetchUserGroups(user.id);
  };

  const handleSaveGroups = async () => {
    if (!editingUser) return;
    setGroupsSaving(true);
    setGroupsError('');
    setGroupsSaveSuccess(false);
    try {
      const res = await fetch(`/api/users/${editingUser.id}/groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupSlugs: Array.from(selectedGroupSlugs) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setGroupsError(data.error || 'Failed to save group memberships');
        return;
      }
      const updated: UserGroupMembership[] = await res.json();
      setUserGroups(updated);
      setSelectedGroupSlugs(new Set(updated.filter((m) => m.source === 'manual').map((m) => m.slug)));
      setGroupsSaveSuccess(true);
      // Update the count in the table
      setUserGroupCounts((prev) => ({ ...prev, [editingUser.id]: updated.length }));
    } catch {
      setGroupsError('Failed to save group memberships');
    } finally {
      setGroupsSaving(false);
    }
  };

  const handleApprove = async (user: UserData) => {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    if (res.ok) fetchUsersAndGroups();
  };

  const [deleteError, setDeleteError] = React.useState('');

  const handleDelete = async (user: UserData) => {
    setDeleteError('');
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setDeleteError(data.error || 'Failed to delete user');
      return;
    }
    fetchUsersAndGroups();
  };

  const [forceLogoutSuccess, setForceLogoutSuccess] = React.useState<string | null>(null);

  const handleForceLogout = async (user: UserData) => {
    const res = await fetch(`/api/users/${user.id}/sessions`, { method: 'DELETE' });
    if (res.ok) {
      setForceLogoutSuccess(`All sessions for ${user.username} revoked`);
      setTimeout(() => setForceLogoutSuccess(null), 4000);
    }
  };

  const toggleGroupSlug = (slug: string, checked: boolean) => {
    setSelectedGroupSlugs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(slug);
      else next.delete(slug);
      return next;
    });
    setGroupsSaveSuccess(false);
  };

  const getRoleBadge = (role: UserRole) => {
    const variants: Record<UserRole, 'default' | 'secondary' | 'outline'> = { Administrator: 'default', Operator: 'secondary', User: 'outline', Customer: 'outline' };
    return <Badge variant={variants[role]}>{role}</Badge>;
  };

  const externalMemberships = userGroups.filter((m) => m.source !== 'manual');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {forceLogoutSuccess && (
        <div className="rounded-lg bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">
          {forceLogoutSuccess}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingUser(null); setError(''); } }}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Add User</Button></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingUser ? 'Edit User' : 'Add User'}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>First Name</Label><Input value={formData.firstname} onChange={(e) => setFormData({ ...formData, firstname: e.target.value })} /></div>
                <div className="space-y-2"><Label>Last Name</Label><Input value={formData.lastname} onChange={(e) => setFormData({ ...formData, lastname: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Username</Label><Input value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Role</Label>
                <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v as UserRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Administrator">Administrator</SelectItem>
                    <SelectItem value="Operator">Operator</SelectItem>
                    <SelectItem value="User">User</SelectItem>
                    <SelectItem value="Customer">Customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Password {editingUser && '(leave blank to keep current)'}</Label><Input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required={!editingUser} /></div>
              <DialogFooter><Button type="submit">{editingUser ? 'Update' : 'Create'} User</Button></DialogFooter>
            </form>

            {editingUser && (
              <>
                <Separator className="my-2" />
                <div className="space-y-3 pb-2">
                  <div>
                    <p className="text-sm font-medium leading-none">Group Memberships</p>
                    <p className="text-xs text-muted-foreground mt-1">Check groups to assign manual memberships. LDAP/OIDC memberships are managed externally.</p>
                  </div>

                  {groupsLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading groups…
                    </div>
                  )}

                  {groupsError && (
                    <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{groupsError}</div>
                  )}

                  {groupsSaveSuccess && (
                    <div className="rounded-lg bg-green-100 p-3 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">
                      Group memberships saved.
                    </div>
                  )}

                  {!groupsLoading && (
                    <>
                      {externalMemberships.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Read-only (from directory)</p>
                          <div className="flex flex-wrap gap-1">
                            {externalMemberships.map((m) => (
                              <Badge key={m.slug} variant="secondary" className="text-xs">
                                {m.name} <span className="ml-1 opacity-60">({m.source})</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {allGroups.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Manual memberships</p>
                          <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                            {allGroups.map((g) => (
                              <div key={g.slug} className="flex items-center gap-3 px-3 py-2">
                                <Checkbox
                                  id={`group-${g.slug}`}
                                  checked={selectedGroupSlugs.has(g.slug)}
                                  onCheckedChange={(checked) => toggleGroupSlug(g.slug, checked === true)}
                                />
                                <label htmlFor={`group-${g.slug}`} className="flex-1 text-sm cursor-pointer select-none">
                                  <span className="font-medium">{g.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">{g.slug}</span>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {allGroups.length === 0 && (
                        <p className="text-xs text-muted-foreground">No groups have been created yet.</p>
                      )}

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={groupsSaving}
                        onClick={handleSaveGroups}
                      >
                        {groupsSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save groups
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[120px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.firstname} {user.lastname}<div className="text-xs text-muted-foreground">@{user.username}</div></TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{getRoleBadge(user.role)}</TableCell>
                <TableCell>
                  {userGroupCounts[user.id] != null && userGroupCounts[user.id] > 0 ? (
                    <Badge variant="secondary" className="text-xs">{userGroupCounts[user.id]} group{userGroupCounts[user.id] !== 1 ? 's' : ''}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{user.authType === 'ldap' ? 'LDAP' : user.authType === 'oidc' ? 'OIDC' : 'Local'}</Badge></TableCell>
                <TableCell>
                  {user.active ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Pending</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(user.created_at)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {!user.active && (
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-green-600 hover:text-green-600" onClick={() => handleApprove(user)}>
                              <UserCheck className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Approve</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <AlertDialog>
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-amber-600 hover:text-amber-600">
                                <LogOut className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>Force logout</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Force logout</AlertDialogTitle>
                          <AlertDialogDescription>
                            Revoke all active sessions for <span className="font-semibold">{user.username}</span>? They will be signed out on their next request.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleForceLogout(user)}>
                            Force logout
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog onOpenChange={(open) => { if (open) { setDeleteError(''); } }}>
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
                          <AlertDialogTitle>Delete user</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete <span className="font-semibold">{user.username}</span>? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        {deleteError && (
                          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{deleteError}</div>
                        )}
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDelete(user)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
