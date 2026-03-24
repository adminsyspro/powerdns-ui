'use client';

import * as React from 'react';
import { Plus, Download, Upload, RefreshCw, AlertCircle, Server, Clock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ZonesTable } from '@/components/zones/zones-table';
import { CreateZoneDialog } from '@/components/zones/create-zone-dialog';
import { useCachedZones, useZoneSync } from '@/hooks/use-pdns';
import { useServerConnectionStore, useActivityLogStore } from '@/stores';
import { formatRelativeTime } from '@/lib/utils';
import * as api from '@/lib/api';

export default function ZonesPage() {
  const { activeConnection } = useServerConnectionStore();
  const { addLog } = useActivityLogStore();
  const { sync, isSyncing, syncStatus } = useZoneSync();
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  // Pagination & filter state
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [dnssec, setDnssec] = React.useState('');
  const [sortBy, setSortBy] = React.useState('serial');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('desc');

  const { data, error, isLoading, refetch } = useCachedZones({
    page,
    pageSize,
    search: search || undefined,
    kind: kind || undefined,
    dnssec: dnssec || undefined,
    sortBy,
    sortOrder,
  });

  // Reset to page 1 when filters change
  const handleSearchChange = (v: string) => { setSearch(v); setPage(1); };
  const handleKindChange = (v: string) => { setKind(v); setPage(1); };
  const handleDnssecChange = (v: string) => { setDnssec(v); setPage(1); };
  const handleSortChange = (col: string, order: 'asc' | 'desc') => { setSortBy(col); setSortOrder(order); setPage(1); };
  const handlePageSizeChange = (size: number) => { setPageSize(size); setPage(1); };

  const handleRefresh = async () => {
    await sync();
    refetch();
  };

  const handleDelete = async (zoneId: string) => {
    if (!confirm(`Are you sure you want to delete zone ${zoneId}?`)) return;
    const result = await api.deleteZone(zoneId);
    if (result.error) {
      alert(`Error deleting zone: ${result.error}`);
    } else {
      addLog({ action: 'Zone Deleted', resource: zoneId, user: 'admin', details: '' });
      await sync();
      refetch();
    }
  };

  const handleNotify = async (zoneId: string) => {
    const result = await api.notifyZone(zoneId);
    if (result.error) {
      alert(`Error sending NOTIFY: ${result.error}`);
    } else {
      addLog({ action: 'NOTIFY Sent', resource: zoneId, user: 'admin', details: '' });
    }
  };

  const handleExport = async (zoneId: string) => {
    const result = await api.exportZone(zoneId);
    if (result.error) {
      alert(`Error exporting zone: ${result.error}`);
      return;
    }
    const blob = new Blob([result.data as string], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${zoneId}.zone`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateZone = async (formData: {
    name: string;
    kind: string;
    nameservers: string[];
    masters?: string[];
    account?: string;
    dnssec?: boolean;
    soaEditApi?: string;
  }) => {
    const result = await api.createZone({
      name: formData.name.endsWith('.') ? formData.name : `${formData.name}.`,
      kind: formData.kind,
      nameservers: formData.nameservers,
      masters: formData.masters,
      account: formData.account,
      dnssec: formData.dnssec,
      soa_edit_api: formData.soaEditApi,
    });
    if (result.error) {
      alert(`Error creating zone: ${result.error}`);
      return;
    }
    addLog({ action: 'Zone Created', resource: formData.name, user: 'admin', details: '' });
    setCreateDialogOpen(false);
    await sync();
    refetch();
  };

  if (!activeConnection) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Zones</h1>
          <p className="text-muted-foreground">Manage your DNS zones and domains</p>
        </div>
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardContent className="flex items-center justify-between py-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">No PowerDNS server connected</p>
                <p className="text-sm text-amber-600 dark:text-amber-400">Configure a server connection first</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href="/servers"><Server className="mr-2 h-4 w-4" />Add Server</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Zones</h1>
          <div className="flex items-center gap-3 text-muted-foreground">
            <p>Manage your DNS zones and domains</p>
            {syncStatus && syncStatus.lastSyncAt > 0 && (
              <span className="flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3" />
                Synced {formatRelativeTime(syncStatus.lastSyncAt)} ({syncStatus.zoneCount?.toLocaleString()} zones)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isSyncing || isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />Import
          </Button>
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />Export All
          </Button>
          <CreateZoneDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            onSubmit={handleCreateZone}
            trigger={
              <Button><Plus className="mr-2 h-4 w-4" />New Zone</Button>
            }
          />
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">Failed to load zones</p>
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="ml-auto">Sync & Retry</Button>
          </CardContent>
        </Card>
      )}

      <ZonesTable
        zones={data?.items || []}
        isLoading={isLoading}
        onDelete={handleDelete}
        onNotify={handleNotify}
        onExport={handleExport}
        serverPagination
        total={data?.total}
        page={data?.page || page}
        pageSize={data?.pageSize || pageSize}
        totalPages={data?.totalPages || 1}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        onSearchChange={handleSearchChange}
        onKindChange={handleKindChange}
        onDnssecChange={handleDnssecChange}
        onSortChange={handleSortChange}
        sortBy={sortBy}
        sortOrder={sortOrder}
        searchValue={search}
        kindValue={kind || 'all'}
        dnssecValue={dnssec || 'all'}
      />
    </div>
  );
}
