'use client';

import * as React from 'react';
import { Activity, Filter, Download, Globe, FileText, User, Plus, Edit, Trash2, LogIn, LogOut, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';
import type { ActivityEntry } from '@/lib/activity/log';
import { PageTitle } from '@/components/layout/page-title';

const PAGE_SIZE = 50;

function getActionIcon(action: string, resourceType: string) {
  const a = action.toLowerCase();
  if (a.includes('creat')) return <Plus className="h-4 w-4 text-green-600" />;
  if (a.includes('updat') || a.includes('edit')) return <Edit className="h-4 w-4 text-blue-600" />;
  if (a.includes('delet')) return <Trash2 className="h-4 w-4 text-red-600" />;
  if (a === 'login') return <LogIn className="h-4 w-4 text-green-600" />;
  if (a === 'logout') return <LogOut className="h-4 w-4 text-muted-foreground" />;
  if (a === 'login_failed') return <ShieldAlert className="h-4 w-4 text-red-600" />;
  if (resourceType === 'zone') return <Globe className="h-4 w-4 text-purple-600" />;
  if (resourceType === 'record') return <FileText className="h-4 w-4 text-orange-600" />;
  if (resourceType === 'user' || resourceType === 'session') return <User className="h-4 w-4 text-cyan-600" />;
  return <Activity className="h-4 w-4" />;
}

function getActionBadge(action: string) {
  const a = action.toLowerCase();
  if (a.includes('creat')) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Create</Badge>;
  if (a.includes('updat') || a.includes('edit')) return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Update</Badge>;
  if (a.includes('delet')) return <Badge variant="destructive">Delete</Badge>;
  if (a === 'login') return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Login</Badge>;
  if (a === 'logout') return <Badge variant="outline">Logout</Badge>;
  if (a === 'login_failed') return <Badge variant="destructive">Login failed</Badge>;
  return <Badge variant="outline">{action}</Badge>;
}

export default function ActivityPage() {
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [actionFilter, setActionFilter] = React.useState<string>('all');
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<api.PaginatedActivity | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchEntries = React.useCallback(async () => {
    setIsLoading(true);
    const result = await api.fetchActivity({
      page,
      pageSize: PAGE_SIZE,
      action: actionFilter === 'all' ? undefined : actionFilter,
      search: debouncedSearch || undefined,
    });
    if (result.data) setData(result.data);
    setIsLoading(false);
  }, [page, actionFilter, debouncedSearch]);

  React.useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const items: ActivityEntry[] = data?.items ?? [];

  const handleExport = () => {
    const csv = [
      'Timestamp,Action,ResourceType,Actor,Resource,Details',
      ...items.map((e) =>
        `${new Date(e.ts * 1000).toISOString()},${e.action},${e.resourceType},${e.actorName},${e.resourceName ?? ''},"${(e.details ?? '').replace(/"/g, '""')}"`
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'activity-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Activity Log" />
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={handleExport} disabled={items.length === 0}>
          <Download className="mr-2 h-4 w-4" />Export
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div><CardTitle className="text-base">Recent Activity</CardTitle><CardDescription>{data?.total ?? 0} entries</CardDescription></div>
            <div className="flex items-center gap-2">
              <Input placeholder="Search..." className="w-[200px]" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select
                value={actionFilter}
                onValueChange={(v) => { setActionFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-[160px]"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="login_failed">Login failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!isLoading && items.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No activity yet</h3>
              <p className="text-muted-foreground">Actions like creating zones and updating records will appear here</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell><div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">{getActionIcon(entry.action, entry.resourceType)}</div></TableCell>
                      <TableCell>{getActionBadge(entry.action)}</TableCell>
                      <TableCell className="font-medium">{entry.actorName}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.resourceType}
                        {entry.resourceName ? `: ${entry.resourceName}` : ''}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[300px] truncate">{entry.details ?? ''}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{formatDateTime(entry.ts * 1000)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {data && data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => p + 1)} disabled={data ? page >= data.totalPages : true}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
