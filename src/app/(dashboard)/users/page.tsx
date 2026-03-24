'use client';

import * as React from 'react';
import { Plus, Edit2, Trash2, Loader2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export default function UsersPage() {
  const [users, setUsers] = React.useState<UserData[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserData | null>(null);
  const [formData, setFormData] = React.useState({ username: '', email: '', firstname: '', lastname: '', role: 'User' as UserRole, password: '' });
  const [error, setError] = React.useState('');

  const fetchUsers = async () => {
    const res = await fetch('/api/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data);
    }
    setIsLoading(false);
  };

  React.useEffect(() => { fetchUsers(); }, []);

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
    fetchUsers();
  };

  const handleEdit = (user: UserData) => {
    setEditingUser(user);
    setFormData({ username: user.username, email: user.email, firstname: user.firstname || '', lastname: user.lastname || '', role: user.role, password: '' });
    setError('');
    setDialogOpen(true);
  };

  const handleApprove = async (user: UserData) => {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    if (res.ok) fetchUsers();
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
    fetchUsers();
  };

  const getRoleBadge = (role: UserRole) => {
    const variants: Record<UserRole, 'default' | 'secondary' | 'outline'> = { Administrator: 'default', Operator: 'secondary', User: 'outline' };
    return <Badge variant={variants[role]}>{role}</Badge>;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingUser(null); setError(''); } }}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Add User</Button></DialogTrigger>
          <DialogContent>
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
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Password {editingUser && '(leave blank to keep current)'}</Label><Input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required={!editingUser} /></div>
              <DialogFooter><Button type="submit">{editingUser ? 'Update' : 'Create'} User</Button></DialogFooter>
            </form>
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
              <TableHead>Auth</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.firstname} {user.lastname}<div className="text-xs text-muted-foreground">@{user.username}</div></TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{getRoleBadge(user.role)}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{user.authType === 'ldap' ? 'LDAP' : 'Local'}</Badge></TableCell>
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
