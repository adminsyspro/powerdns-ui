'use client';

import * as React from 'react';
import { Activity, Filter, Download, Globe, FileText, User, Trash2, Plus, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/utils';
import { useActivityLogStore } from '@/stores';

export default function ActivityPage() {
  const { logs, clearLogs } = useActivityLogStore();
  const [searchTerm, setSearchTerm] = React.useState('');
  const [actionFilter, setActionFilter] = React.useState<string>('all');

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.resource.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.details.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === 'all' || log.action.toLowerCase().includes(actionFilter);
    return matchesSearch && matchesAction;
  });

  const getActionIcon = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('creat')) return <Plus className="h-4 w-4 text-green-600" />;
    if (a.includes('updat') || a.includes('edit')) return <Edit className="h-4 w-4 text-blue-600" />;
    if (a.includes('delet')) return <Trash2 className="h-4 w-4 text-red-600" />;
    if (a.includes('zone')) return <Globe className="h-4 w-4 text-purple-600" />;
    if (a.includes('record')) return <FileText className="h-4 w-4 text-orange-600" />;
    if (a.includes('user')) return <User className="h-4 w-4 text-cyan-600" />;
    return <Activity className="h-4 w-4" />;
  };

  const getActionBadge = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('creat')) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Create</Badge>;
    if (a.includes('updat') || a.includes('edit')) return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Update</Badge>;
    if (a.includes('delet')) return <Badge variant="destructive">Delete</Badge>;
    if (a.includes('notify')) return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">Notify</Badge>;
    return <Badge variant="outline">{action}</Badge>;
  };

  const handleExport = () => {
    const csv = [
      'Timestamp,Action,User,Resource,Details',
      ...logs.map(l => `${new Date(l.timestamp).toISOString()},${l.action},${l.user},${l.resource},"${l.details}"`)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activity Log</h1>
          <p className="text-muted-foreground">Track all actions performed in the system</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={logs.length === 0}>
            <Download className="mr-2 h-4 w-4" />Export
          </Button>
          {logs.length > 0 && (
            <Button variant="outline" onClick={() => { if (confirm('Clear all activity logs?')) clearLogs(); }}>
              <Trash2 className="mr-2 h-4 w-4" />Clear
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div><CardTitle className="text-base">Recent Activity</CardTitle><CardDescription>{filteredLogs.length} entries</CardDescription></div>
            <div className="flex items-center gap-2">
              <Input placeholder="Search..." className="w-[200px]" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[150px]"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="zone">Zones</SelectItem>
                  <SelectItem value="record">Records</SelectItem>
                  <SelectItem value="notify">Notify</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No activity yet</h3>
              <p className="text-muted-foreground">Actions like creating zones and updating records will appear here</p>
            </div>
          ) : (
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
                {filteredLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell><div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">{getActionIcon(log.action)}</div></TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell className="font-medium">{log.user}</TableCell>
                    <TableCell className="font-mono text-xs">{log.resource}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[300px] truncate">{log.details}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{formatDateTime(log.timestamp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
