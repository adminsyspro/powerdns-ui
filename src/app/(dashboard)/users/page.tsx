'use client';

import * as React from 'react';
import { Plus, MoreHorizontal, Edit2, Trash2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';
import type { User, UserRole } from '@/types/powerdns';

const mockUsers: User[] = [
  { id: '1', username: 'admin', email: 'admin@example.com', firstname: 'Admin', lastname: 'User', role: 'Administrator', active: true, created_at: new Date('2024-01-01'), updated_at: new Date() },
  { id: '2', username: 'operator1', email: 'op1@example.com', firstname: 'John', lastname: 'Doe', role: 'Operator', active: true, created_at: new Date('2024-01-15'), updated_at: new Date() },
  { id: '3', username: 'user1', email: 'user1@example.com', firstname: 'Jane', lastname: 'Smith', role: 'User', active: true, created_at: new Date('2024-02-01'), updated_at: new Date() },
  { id: '4', username: 'operator2', email: 'op2@example.com', firstname: 'Bob', lastname: 'Wilson', role: 'Operator', active: false, created_at: new Date('2024-02-15'), updated_at: new Date() },
];

export default function UsersPage() {
  const [users, setUsers] = React.useState<User[]>(mockUsers);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<User | null>(null);
  const [formData, setFormData] = React.useState({ username: '', email: '', firstname: '', lastname: '', role: 'User' as UserRole, password: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...formData, updated_at: new Date() } : u));
    } else {
      setUsers([...users, { ...formData, id: Date.now().toString(), active: true, created_at: new Date(), updated_at: new Date() }]);
    }
    setDialogOpen(false);
    setEditingUser(null);
    setFormData({ username: '', email: '', firstname: '', lastname: '', role: 'User', password: '' });
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, email: user.email, firstname: user.firstname || '', lastname: user.lastname || '', role: user.role, password: '' });
    setDialogOpen(true);
  };

  const getRoleBadge = (role: UserRole) => {
    const variants: Record<UserRole, 'default' | 'secondary' | 'outline'> = { Administrator: 'default', Operator: 'secondary', User: 'outline' };
    return <Badge variant={variants[role]}>{role}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Add User</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingUser ? 'Edit User' : 'Add User'}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.firstname} {user.lastname}<div className="text-xs text-muted-foreground">@{user.username}</div></TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{getRoleBadge(user.role)}</TableCell>
                <TableCell><Badge variant={user.active ? 'success' : 'secondary'}>{user.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{formatDate(user.created_at)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(user)}><Edit2 className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setUsers(users.filter(u => u.id !== user.id))}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
