'use client';

import * as React from 'react';
import { Plus, Download, Upload, RefreshCw, AlertCircle, Server, Clock, Search, Globe, FileText, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ZonesTable } from '@/components/zones/zones-table';
import { CreateZoneDialog } from '@/components/zones/create-zone-dialog';
import { useCachedZones, useZoneSync } from '@/hooks/use-pdns';
import { useConfirm } from '@/hooks/use-confirm';
import { useServerConnectionStore, useActivityLogStore } from '@/stores';
import { formatRelativeTime, getRecordTypeColor } from '@/lib/utils';
import * as api from '@/lib/api';
import type { SearchResult } from '@/types/powerdns';

export default function ZonesPage() {
  const { activeConnection } = useServerConnectionStore();
  const { addLog } = useActivityLogStore();
  const { sync, isSyncing, syncStatus } = useZoneSync();
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  // Global search state
  const [globalResults, setGlobalResults] = React.useState<SearchResult[]>([]);
  const [isGlobalSearching, setIsGlobalSearching] = React.useState(false);
  const [globalSearchError, setGlobalSearchError] = React.useState<string | null>(null);
  const [showGlobalResults, setShowGlobalResults] = React.useState(false);

  const handleGlobalSearch = async (q: string) => {
    if (!q.trim() || !activeConnection) return;
    setIsGlobalSearching(true);
    setGlobalSearchError(null);
    setShowGlobalResults(true);
    const result = await api.searchPdns(q);
    if (result.error) {
      setGlobalSearchError(result.error);
      setGlobalResults([]);
    } else {
      setGlobalResults(result.data || []);
    }
    setIsGlobalSearching(false);
  };

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
    const ok = await confirm({
      title: 'Delete zone',
      description: `Are you sure you want to delete zone "${zoneId}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    const result = await api.deleteZone(zoneId);
    if (result.error) {
      alert(`Error deleting zone: ${result.error}`);
    } else {
      addLog({ action: 'Zone Deleted', resource: zoneId, user: 'admin', details: '' });
      await sync();
      refetch();
    }
  };

  const handleBulkDelete = async (zoneIds: string[]) => {
    const ok = await confirm({
      title: 'Delete zones',
      description: `Are you sure you want to delete ${zoneIds.length} zone(s)? This action cannot be undone.`,
      confirmLabel: 'Delete all',
      variant: 'destructive',
    });
    if (!ok) return;
    let errors = 0;
    for (const id of zoneIds) {
      const result = await api.deleteZone(id);
      if (result.error) {
        errors++;
      } else {
        addLog({ action: 'Zone Deleted', resource: id, user: 'admin', details: 'Bulk delete' });
      }
    }
    if (errors > 0) alert(`${errors} zone(s) could not be deleted.`);
    await sync();
    refetch();
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
      </div>

      {globalSearchError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-600 dark:text-red-400">{globalSearchError}</p>
          </CardContent>
        </Card>
      )}

      {showGlobalResults && !globalSearchError && (
        (() => {
          const zones = globalResults.filter((r) => r.object_type === 'zone');
          const records = globalResults.filter((r) => r.object_type === 'record');
          const comments = globalResults.filter((r) => r.object_type === 'comment');

          if (globalResults.length === 0 && !isGlobalSearching) {
            return (
              <div className="text-center py-8">
                <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold">No results found</h3>
                <p className="text-xs text-muted-foreground">Try adjusting your search terms</p>
              </div>
            );
          }

          if (globalResults.length > 0) {
            return (
              <Card>
                <CardContent className="pt-4">
                  <Tabs defaultValue="all" className="space-y-3">
                    <TabsList>
                      <TabsTrigger value="all">All ({globalResults.length})</TabsTrigger>
                      <TabsTrigger value="zones">Zones ({zones.length})</TabsTrigger>
                      <TabsTrigger value="records">Records ({records.length})</TabsTrigger>
                      <TabsTrigger value="comments">Comments ({comments.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="all" className="space-y-1 max-h-[400px] overflow-y-auto">
                      {globalResults.map((r, i) => <GlobalSearchResultRow key={i} result={r} />)}
                    </TabsContent>
                    <TabsContent value="zones" className="space-y-1 max-h-[400px] overflow-y-auto">
                      {zones.map((r, i) => <GlobalSearchResultRow key={i} result={r} />)}
                    </TabsContent>
                    <TabsContent value="records" className="space-y-1 max-h-[400px] overflow-y-auto">
                      {records.map((r, i) => <GlobalSearchResultRow key={i} result={r} />)}
                    </TabsContent>
                    <TabsContent value="comments" className="space-y-1 max-h-[400px] overflow-y-auto">
                      {comments.length === 0
                        ? <p className="text-muted-foreground text-center py-4 text-sm">No comments found</p>
                        : comments.map((r, i) => <GlobalSearchResultRow key={i} result={r} />)}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            );
          }

          return null;
        })()
      )}

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
        onGlobalSearch={handleGlobalSearch}
        isGlobalSearching={isGlobalSearching}
        onBulkDelete={handleBulkDelete}
        actions={
          <>
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
                <Button size="sm"><Plus className="mr-2 h-4 w-4" />New Zone</Button>
              }
            />
          </>
        }
      />
      <ConfirmDialog />
    </div>
  );
}

function GlobalSearchResultRow({ result }: { result: SearchResult }) {
  const Icon = result.object_type === 'zone' ? Globe : result.object_type === 'record' ? FileText : MessageSquare;
  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50 transition-colors">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/zones/${encodeURIComponent(result.zone_id)}`} className="text-sm font-medium hover:underline truncate">
            {result.name}
          </Link>
          {result.type && (
            <Badge className={getRecordTypeColor(result.type)} variant="outline">{result.type}</Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">{result.object_type}</Badge>
        </div>
        {result.content && (
          <p className="text-xs text-muted-foreground font-mono truncate">{result.content}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{result.zone}</span>
    </div>
  );
}
