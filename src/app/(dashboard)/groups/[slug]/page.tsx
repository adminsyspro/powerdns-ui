'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

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

interface GroupMember {
  userId: string;
  username: string;
  role: string;
  source: 'manual' | 'ldap' | 'oidc';
}

interface GroupZone {
  id: string;
  name: string;
  kind: string;
  dnssec: boolean;
  account: string;
}

interface UserOption {
  id: string;
  username: string;
  role: string;
}

function sourceBadge(source: string) {
  if (source === 'ldap') return <Badge variant="secondary" className="text-xs">LDAP</Badge>;
  if (source === 'oidc') return <Badge variant="secondary" className="text-xs">OIDC</Badge>;
  return <Badge variant="outline" className="text-xs">Manual</Badge>;
}

function roleBadge(role: string) {
  const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
    Administrator: 'default',
    Operator: 'secondary',
    User: 'outline',
    Customer: 'outline',
  };
  return <Badge variant={variants[role] ?? 'outline'}>{role}</Badge>;
}

function kindBadge(kind: string) {
  const colors: Record<string, string> = {
    Native: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    Master: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    Slave: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    Producer: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    Consumer: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[kind] ?? 'bg-muted text-muted-foreground'}`}>
      {kind}
    </span>
  );
}

// ---------- Members Tab ----------

function MembersTab({ slug }: { slug: string }) {
  const [members, setMembers] = React.useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  // Add member dialog
  const [addOpen, setAddOpen] = React.useState(false);
  const [allUsers, setAllUsers] = React.useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = React.useState('');
  const [addError, setAddError] = React.useState('');
  const [addLoading, setAddLoading] = React.useState(false);

  // Remove error
  const [removeError, setRemoveError] = React.useState('');

  const fetchMembers = React.useCallback(async () => {
    setError('');
    const res = await fetch(`/api/groups/${slug}/members`);
    if (res.ok) {
      const data = await res.json();
      setMembers(data);
    } else {
      setError('Failed to load members.');
    }
    setIsLoading(false);
  }, [slug]);

  React.useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const openAddDialog = async () => {
    setAddError('');
    setSelectedUserId('');
    setAddOpen(true);
    const res = await fetch('/api/users');
    if (res.ok) {
      const data: UserOption[] = await res.json();
      const memberIds = new Set(members.map((m) => m.userId));
      setAllUsers(data.filter((u) => !memberIds.has(u.id)));
    }
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    setAddError('');
    setAddLoading(true);
    const res = await fetch(`/api/groups/${slug}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId }),
    });
    setAddLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || 'Failed to add member');
      return;
    }
    setAddOpen(false);
    fetchMembers();
  };

  const handleRemove = async (member: GroupMember) => {
    setRemoveError('');
    const res = await fetch(`/api/groups/${slug}/members/${member.userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      if (res.status === 409) {
        setRemoveError(`Cannot remove ${member.username}: membership is managed by ${member.source}.`);
      } else {
        setRemoveError(data.error || 'Failed to remove member');
      }
      return;
    }
    fetchMembers();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Member</Button>
      </div>

      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {removeError && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{removeError}</div>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">@{member.username}</TableCell>
                  <TableCell>{roleBadge(member.role)}</TableCell>
                  <TableCell>{sourceBadge(member.source)}</TableCell>
                  <TableCell>
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive disabled:opacity-40"
                              disabled={member.source !== 'manual'}
                              onClick={() => handleRemove(member)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {member.source !== 'manual' && (
                          <TooltipContent>Managed by {member.source} — cannot remove manually</TooltipContent>
                        )}
                        {member.source === 'manual' && (
                          <TooltipContent>Remove from group</TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setAddError(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {addError && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{addError}</div>}
            <div className="space-y-2">
              <Label>User</Label>
              {allUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">All users are already members of this group.</p>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.username} <span className="text-muted-foreground">({u.role})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleAddMember}
              disabled={!selectedUserId || addLoading || allUsers.length === 0}
            >
              {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Zones Tab ----------

function ZonesTab({ slug }: { slug: string }) {
  const [zones, setZones] = React.useState<GroupZone[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/groups/${slug}/zones`);
      if (res.ok) {
        const data = await res.json();
        setZones(data);
      } else {
        setError('Failed to load zones.');
      }
      setIsLoading(false);
    };
    load();
  }, [slug]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{zones.length} zone{zones.length !== 1 ? 's' : ''} (read-only view)</p>
      {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zone Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>DNSSEC</TableHead>
              <TableHead>Account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {zones.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No zones assigned to this group.
                </TableCell>
              </TableRow>
            ) : (
              zones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell className="font-medium font-mono text-sm">{zone.name}</TableCell>
                  <TableCell>{kindBadge(zone.kind)}</TableCell>
                  <TableCell>
                    {zone.dnssec
                      ? <Badge variant="default" className="text-xs">Enabled</Badge>
                      : <Badge variant="outline" className="text-xs">Disabled</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-muted-foreground">{zone.account || <span className="italic">—</span>}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------- Main Page ----------

export default function GroupDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [group, setGroup] = React.useState<GroupSummary | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!slug) return;
    const load = async () => {
      const res = await fetch(`/api/groups/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setGroup(data);
      } else if (res.status === 404) {
        setError('Group not found.');
      } else {
        setError('Failed to load group.');
      }
      setIsLoading(false);
    };
    load();
  }, [slug]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="space-y-4">
        <Link href="/groups">
          <Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back to Groups</Button>
        </Link>
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error || 'Group not found.'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle title={group?.name ?? 'Group'} />
      {/* Header */}
      <div>
        <Link href="/groups">
          <Button variant="ghost" size="sm" className="mb-2"><ArrowLeft className="mr-2 h-4 w-4" />Back to Groups</Button>
        </Link>
        <p className="text-muted-foreground font-mono text-sm mt-1">{group.slug}</p>
        {group.description && (
          <p className="text-muted-foreground mt-1">{group.description}</p>
        )}
        <div className="flex items-start justify-end">
          <div className="flex gap-2">
            <Badge variant="secondary">{group.memberCount} member{group.memberCount !== 1 ? 's' : ''}</Badge>
            <Badge variant="outline">{group.zoneCount} zone{group.zoneCount !== 1 ? 's' : ''}</Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="zones">Zones</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4">
          <MembersTab slug={slug} />
        </TabsContent>
        <TabsContent value="zones" className="mt-4">
          <ZonesTab slug={slug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
