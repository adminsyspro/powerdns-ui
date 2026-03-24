'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Shield, RefreshCw, Download, Trash2, AlertCircle, Loader2,
  Copy, FileText, FileSpreadsheet, ChevronsUpDown, Check, Search, CalendarClock, Globe2, History, Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RecordsTable } from '@/components/records/records-table';
import { RecordFormDialog } from '@/components/records/record-form-dialog';
import { PendingChangesBar } from '@/components/records/pending-changes-bar';
import { ValidationModal } from '@/components/records/validation-modal';
import { ChangeDiffCard } from '@/components/records/change-diff-card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChangesetSubmission } from '@/types/powerdns';
import type { RRSet, ZoneListItem } from '@/types/powerdns';
import { formatSerial, getZoneKindColor, parseSOA, copyToClipboard } from '@/lib/utils';
import { mergeRecordsWithPending } from '@/lib/pending-changes-utils';
import { useZone } from '@/hooks/use-pdns';
import { useConfirm } from '@/hooks/use-confirm';
import { useActivityLogStore, usePendingChangesStore } from '@/stores';
import * as api from '@/lib/api';

// ---- Zone Switcher ----

function ZoneSwitcher({ currentZoneId }: { currentZoneId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [zones, setZones] = React.useState<ZoneListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(true);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 50;

  // Reset and fetch first page when popover opens or search changes
  React.useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setPage(1);
    setHasMore(true);
    const timer = setTimeout(async () => {
      const result = await api.fetchCachedZones({
        page: 1,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        sortBy: 'name',
        sortOrder: 'asc',
      });
      if (result.data) {
        setZones(result.data.items);
        setHasMore(result.data.page < result.data.totalPages);
      }
      setIsLoading(false);
    }, search ? 200 : 0);
    return () => clearTimeout(timer);
  }, [open, search]);

  // Load more on scroll
  const loadMore = React.useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    const nextPage = page + 1;
    setIsLoadingMore(true);
    const result = await api.fetchCachedZones({
      page: nextPage,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    if (result.data) {
      setZones((prev) => [...prev, ...result.data!.items]);
      setPage(nextPage);
      setHasMore(nextPage < result.data.totalPages);
    }
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore, page, search]);

  const handleScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMore();
    }
  }, [loadMore]);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const displayName = currentZoneId.replace(/\.$/, '');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-auto py-1 px-3 text-left gap-2 max-w-[400px]">
          <Globe2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <h1 className="text-2xl font-bold tracking-tight truncate">{displayName}</h1>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search zones..."
              className="pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1" onScroll={handleScroll}>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : zones.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No zones found</p>
          ) : (
            <>
              {zones.map((z) => {
                const isActive = z.id === currentZoneId;
                return (
                  <button
                    key={z.id}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
                      isActive ? 'bg-accent' : 'hover:bg-muted'
                    }`}
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) router.push(`/zones/${encodeURIComponent(z.id)}`);
                    }}
                  >
                    <Globe2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{z.name.replace(/\.$/, '')}</span>
                    <Badge variant="outline" className={`${getZoneKindColor(z.kind)} text-[10px] px-1.5 py-0 ml-auto flex-shrink-0`}>{z.kind}</Badge>
                  </button>
                );
              })}
              {isLoadingMore && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---- Record Export Helpers ----

function recordsToText(records: RRSet[], zoneName: string): string {
  const lines: string[] = [];
  for (const rrset of records) {
    for (const rec of rrset.records) {
      lines.push(`${rrset.name}\t${rrset.ttl}\tIN\t${rrset.type}\t${rec.content}`);
    }
  }
  return lines.join('\n');
}

function recordsToCsv(records: RRSet[]): string {
  const lines = ['Name,Type,TTL,Content,Disabled'];
  for (const rrset of records) {
    for (const rec of rrset.records) {
      lines.push(`"${rrset.name}","${rrset.type}",${rrset.ttl},"${rec.content}",${rec.disabled}`);
    }
  }
  return lines.join('\n');
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(records: RRSet[], zoneName: string) {
  // Generate a printable HTML table and open print dialog
  const rows = records.flatMap((rrset) =>
    rrset.records.map((rec) =>
      `<tr><td>${rrset.name}</td><td>${rrset.type}</td><td>${rrset.ttl}</td><td>${rec.content}</td></tr>`
    )
  ).join('');

  const html = `<!DOCTYPE html><html><head><title>${zoneName} - DNS Records</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:40px;color:#1a1a1a}
  h1{font-size:20px;margin-bottom:4px} p{color:#666;margin-bottom:16px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:6px 12px;border-bottom:1px solid #e5e7eb}
  th{background:#f9fafb;font-weight:600;font-size:12px;text-transform:uppercase;color:#6b7280}
  td:nth-child(4){font-family:monospace;font-size:12px}
  @media print{body{margin:20px}}
</style></head><body>
<h1>${zoneName}</h1><p>${records.length} record sets &bull; Exported ${new Date().toLocaleString()}</p>
<table><thead><tr><th>Name</th><th>Type</th><th>TTL</th><th>Content</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }
}

// ---- Main Page ----

export default function ZoneDetailPage() {
  const params = useParams();
  const router = useRouter();
  const zoneId = decodeURIComponent(params.id as string);
  const { addLog } = useActivityLogStore();
  const { addChange, getZoneChanges, removeChange } = usePendingChangesStore();

  const { data: zone, error, isLoading, refetch } = useZone(zoneId);
  const { confirm, ConfirmDialog } = useConfirm();
  const [recordDialogOpen, setRecordDialogOpen] = React.useState(false);
  const [editingRecord, setEditingRecord] = React.useState<RRSet | undefined>();
  const [validationOpen, setValidationOpen] = React.useState(false);
  const [lookup, setLookup] = React.useState<api.DomainLookup | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyData, setHistoryData] = React.useState<ChangesetSubmission[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  // Paginated records state
  const [recordsPage, setRecordsPage] = React.useState(1);
  const [recordsPageSize, setRecordsPageSize] = React.useState(25);
  const [recordsSearch, setRecordsSearch] = React.useState('');
  const [recordsType, setRecordsType] = React.useState('all');
  const [paginatedData, setPaginatedData] = React.useState<api.PaginatedRecordsResponse | null>(null);
  const [recordsLoading, setRecordsLoading] = React.useState(false);

  // Fetch paginated records
  const fetchRecords = React.useCallback(async () => {
    setRecordsLoading(true);
    const result = await api.fetchZoneRecords(zoneId, {
      page: recordsPage,
      pageSize: recordsPageSize,
      search: recordsSearch || undefined,
      type: recordsType !== 'all' ? recordsType : undefined,
    });
    if (result.data) {
      setPaginatedData(result.data);
    }
    setRecordsLoading(false);
  }, [zoneId, recordsPage, recordsPageSize, recordsSearch, recordsType]);

  React.useEffect(() => {
    if (zone) fetchRecords();
  }, [fetchRecords, zone]);

  const handleRecordsPageChange = (page: number) => setRecordsPage(page);
  const handleRecordsPageSizeChange = (size: number) => {
    setRecordsPageSize(size);
    setRecordsPage(1);
  };
  const handleRecordsSearchChange = (search: string) => {
    setRecordsSearch(search);
    setRecordsPage(1);
  };
  const handleRecordsTypeChange = (type: string) => {
    setRecordsType(type);
    setRecordsPage(1);
  };

  const handleOpenHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    const result = await api.fetchChangeHistory({ zoneId, page: 1, pageSize: 50 });
    if (result.data) setHistoryData(result.data.items);
    setHistoryLoading(false);
  };

  const pendingChanges = getZoneChanges(zoneId);
  const pendingMap = React.useMemo(() => {
    const map = new Map<string, typeof pendingChanges[0]>();
    for (const c of pendingChanges) map.set(c.rrsetKey, c);
    return map;
  }, [pendingChanges]);

  // Build rrsets from paginated items (current page only) for the table
  const pageRrsets = React.useMemo(() => {
    if (!paginatedData?.items) return [];
    // Group flat records back into RRSets
    const map = new Map<string, RRSet>();
    for (const item of paginatedData.items) {
      const key = `${item.name}::${item.type}`;
      const existing = map.get(key);
      if (existing) {
        existing.records.push({ content: item.content, disabled: item.disabled });
      } else {
        map.set(key, {
          name: item.name,
          type: item.type as RRSet['type'],
          ttl: item.ttl,
          records: [{ content: item.content, disabled: item.disabled }],
          comments: item.comments,
        });
      }
    }
    return Array.from(map.values());
  }, [paginatedData?.items]);

  // Merge current page records with pending changes for display
  const mergedRecords = React.useMemo(() => {
    if (!pageRrsets.length && !pendingChanges.length) return [];
    return mergeRecordsWithPending(pageRrsets, pendingChanges);
  }, [pageRrsets, pendingChanges]);

  // Fetch NS + WHOIS lookup when zone loads
  React.useEffect(() => {
    if (!zoneId) return;
    const domain = zoneId.replace(/\.$/, '');
    api.fetchDomainLookup(domain).then((res) => {
      if (res.data) setLookup(res.data);
    });
  }, [zoneId]);

  const soaRecord = zone?.rrsets?.find((r) => r.type === 'SOA');
  const soaData = soaRecord ? parseSOA(soaRecord.records[0]?.content || '') : null;

  const handleEditRecord = (record: RRSet) => {
    setEditingRecord(record);
    setRecordDialogOpen(true);
  };

  const handleDeleteRecord = async (record: RRSet) => {
    const ok = await confirm({
      title: 'Delete record',
      description: `Delete ${record.type} record for "${record.name}"?`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    addChange(zoneId, 'DELETE', record, null);
  };

  const handleToggleRecord = (record: RRSet, disabled: boolean) => {
    const after: RRSet = {
      ...record,
      records: record.records.map((r) => ({ ...r, disabled })),
    };
    addChange(zoneId, 'TOGGLE', record, after);
  };

  const handleSaveRecord = async (data: {
    name: string;
    type: string;
    ttl: number;
    content: string;
    disabled?: boolean;
    comment?: string;
  }) => {
    const recordName = data.name === '@' || data.name === ''
      ? zone!.name
      : data.name.endsWith('.')
        ? data.name
        : `${data.name}.${zone!.name}`;

    const rrset: RRSet = {
      name: recordName,
      type: data.type as RRSet['type'],
      ttl: data.ttl,
      records: [{ content: data.content, disabled: data.disabled || false }],
      comments: data.comment
        ? [{ content: data.comment, account: 'admin', modified_at: Math.floor(Date.now() / 1000) }]
        : [],
    };

    if (editingRecord) {
      // Editing: keep other records in the RRSet
      const existingRecords = editingRecord.records.map((r) => ({
        content: r.content === data.content ? data.content : r.content,
        disabled: r.content === data.content ? (data.disabled || false) : r.disabled,
      }));
      if (!editingRecord.records.find((r) => r.content === data.content)) {
        rrset.records = [
          ...editingRecord.records.filter((r) => r.content !== editingRecord.records[0]?.content),
          { content: data.content, disabled: data.disabled || false },
        ];
      } else {
        rrset.records = existingRecords;
      }
      addChange(zoneId, 'EDIT', editingRecord, rrset);
    } else {
      addChange(zoneId, 'ADD', null, rrset);
    }

    setRecordDialogOpen(false);
    setEditingRecord(undefined);
  };

  const handleBulkDelete = async (records: RRSet[]) => {
    const ok = await confirm({
      title: 'Delete records',
      description: `Delete ${records.length} record(s)? They will be added to pending changes.`,
      confirmLabel: 'Delete all',
      variant: 'destructive',
    });
    if (!ok) return;
    for (const record of records) {
      addChange(zoneId, 'DELETE', record, null);
    }
  };

  const handleBulkToggle = (records: RRSet[], disabled: boolean) => {
    for (const record of records) {
      const after: RRSet = {
        ...record,
        records: record.records.map((r) => ({ ...r, disabled })),
      };
      addChange(zoneId, 'TOGGLE', record, after);
    }
  };

  const handleUndoChange = (changeId: string) => {
    removeChange(zoneId, changeId);
  };

  const handleApplySuccess = () => {
    addLog({ action: 'Records Updated', resource: zoneName, user: 'admin', details: `${pendingChanges.length} changes applied` });
    refetch();
    fetchRecords();
  };

  const zoneName = zone?.name || zoneId;

  const handleDeleteZone = async () => {
    const ok = await confirm({
      title: 'Delete zone',
      description: `Are you sure you want to delete zone "${zoneId}"? This action cannot be undone.`,
      confirmLabel: 'Delete zone',
      variant: 'destructive',
    });
    if (!ok) return;
    const result = await api.deleteZone(zoneId);
    if (result.error) {
      alert(`Error deleting zone: ${result.error}`);
    } else {
      addLog({ action: 'Zone Deleted', resource: zoneId, user: 'admin', details: '' });
      router.push('/zones');
    }
  };

  const handleExportZone = async () => {
    const result = await api.exportZone(zoneId);
    if (result.error) {
      alert(`Error exporting zone: ${result.error}`);
      return;
    }
    downloadFile(result.data as string, `${zoneId}.zone`, 'text/plain');
  };

  // Record export handlers
  const handleCopyRecords = () => {
    if (!zone?.rrsets) return;
    copyToClipboard(recordsToText(zone.rrsets, zone.name));
  };

  const handleExportText = () => {
    if (!zone?.rrsets) return;
    downloadFile(recordsToText(zone.rrsets, zone.name), `${zone.name.replace(/\.$/, '')}-records.txt`, 'text/plain');
  };

  const handleExportCsv = () => {
    if (!zone?.rrsets) return;
    downloadFile(recordsToCsv(zone.rrsets), `${zone.name.replace(/\.$/, '')}-records.csv`, 'text/csv');
  };

  const handleExportPdf = () => {
    if (!zone?.rrsets) return;
    downloadPdf(zone.rrsets, zone.name.replace(/\.$/, ''));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !zone) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/zones"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">{zoneId}</h1>
        </div>
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">Failed to load zone</p>
              <p className="text-sm text-red-600 dark:text-red-400">{error || 'Zone not found'}</p>
            </div>
            <Button variant="outline" size="sm" onClick={refetch} className="ml-auto">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-6">
      {/* Header + Zone info bar */}
      <Card>
        <CardContent className="py-3">
          {/* Line 1: Zone switcher + NS + Expiration + Actions */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <Button variant="ghost" size="icon" className="flex-shrink-0" asChild>
                <Link href="/zones"><ArrowLeft className="h-4 w-4" /></Link>
              </Button>
              <ZoneSwitcher currentZoneId={zoneId} />
              {lookup && lookup.ns.length > 0 && (
                <>
                  <div className="w-px h-5 bg-border" />
                  <div className="flex items-center gap-1.5 text-xs">
                    <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    {lookup.ns.map((ns) => (
                      <Badge key={ns} variant="outline" className="font-mono text-[11px] font-normal py-0">{ns}</Badge>
                    ))}
                  </div>
                </>
              )}
              {lookup?.expiration && (
                <>
                  <div className="w-px h-5 bg-border" />
                  <div className="flex items-center gap-1.5 text-xs">
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className={`font-mono ${
                      new Date(lookup.expiration).getTime() < Date.now() + 30 * 86400000
                        ? 'text-red-600 font-medium'
                        : new Date(lookup.expiration).getTime() < Date.now() + 90 * 86400000
                          ? 'text-amber-600'
                          : ''
                    }`}>
                      {new Date(lookup.expiration).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </>
              )}
              {lookup?.registrar && (
                <>
                  <div className="w-px h-5 bg-border" />
                  <span className="text-xs text-muted-foreground">{lookup.registrar}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={refetch}>
                <RefreshCw className="mr-2 h-4 w-4" />Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenHistory}>
                <History className="mr-2 h-4 w-4" />History
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDeleteZone}>
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </Button>
            </div>
          </div>
          {/* Line 2: Zone metadata */}
          <div className="flex flex-wrap items-center gap-3 text-sm border-t pt-3">
            <Badge className={getZoneKindColor(zone.kind)}>{zone.kind}</Badge>
            {zone.dnssec && (
              <Badge variant="secondary" className="gap-1">
                <Shield className="h-3 w-3" />DNSSEC
              </Badge>
            )}
            <div className="w-px h-4 bg-border" />
            <span><span className="text-muted-foreground">Serial:</span> <span className="font-mono">{formatSerial(zone.serial)}</span></span>
            <div className="w-px h-4 bg-border" />
            <span><span className="text-muted-foreground">Records:</span> <span className="font-mono font-medium">{zone.rrsets?.length || 0}</span></span>
            {zone.account && (
              <>
                <div className="w-px h-4 bg-border" />
                <span><span className="text-muted-foreground">Account:</span> <span className="font-mono">{zone.account}</span></span>
              </>
            )}
            <div className="w-px h-4 bg-border" />
            <span><span className="text-muted-foreground">SOA-EDIT-API:</span> <span className="font-mono">{zone.soa_edit_api || 'DEFAULT'}</span></span>
            <div className="w-px h-4 bg-border" />
            <span><span className="text-muted-foreground">API Rectify:</span> <span className="font-mono">{zone.api_rectify ? 'Enabled' : 'Disabled'}</span></span>
          </div>
        </CardContent>
      </Card>

      {/* Records */}
      <RecordsTable
        records={pageRrsets.length > 0 ? pageRrsets : (zone.rrsets || [])}
        zoneName={zone.name}
        isLoading={recordsLoading}
        onEdit={handleEditRecord}
        onDelete={handleDeleteRecord}
        onToggle={handleToggleRecord}
        onAdd={() => { setEditingRecord(undefined); setRecordDialogOpen(true); }}
        onCopyAll={handleCopyRecords}
        onExportText={handleExportText}
        onExportCsv={handleExportCsv}
        onExportPdf={handleExportPdf}
        mergedRecords={mergedRecords}
        onUndoChange={handleUndoChange}
        zoneId={zoneId}
        pagination={paginatedData ? {
          page: paginatedData.page,
          pageSize: paginatedData.pageSize,
          total: paginatedData.total,
          totalPages: paginatedData.totalPages,
        } : undefined}
        onPageChange={handleRecordsPageChange}
        onPageSizeChange={handleRecordsPageSizeChange}
        onSearchChange={handleRecordsSearchChange}
        onTypeFilterChange={handleRecordsTypeChange}
        serverTypeStats={paginatedData?.typeStats}
        onBulkDelete={handleBulkDelete}
        onBulkToggle={handleBulkToggle}
      />

      {/* Record Form Dialog */}
      <RecordFormDialog
        open={recordDialogOpen}
        onOpenChange={setRecordDialogOpen}
        zoneName={zone.name}
        record={editingRecord}
        onSubmit={handleSaveRecord}
      />

      {/* Pending Changes Bar */}
      <PendingChangesBar zoneId={zoneId} onOpenValidation={() => setValidationOpen(true)} />

      {/* Validation Modal */}
      <ValidationModal
        open={validationOpen}
        onOpenChange={setValidationOpen}
        zoneId={zoneId}
        zoneName={zone.name}
        onSuccess={handleApplySuccess}
      />

      {/* Zone History Timeline Modal */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Change History — {zoneName.replace(/\.$/, '')}</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : historyData.length === 0 ? (
            <div className="text-center py-12">
              <History className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No change history for this zone</p>
            </div>
          ) : (
            <ScrollArea className="flex-1 -mx-6 px-6" style={{ maxHeight: '65vh' }}>
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

                <div className="space-y-0">
                  {historyData.map((entry, idx) => {
                    const adds = entry.changes.filter((c) => c.action === 'ADD').length;
                    const edits = entry.changes.filter((c) => c.action === 'EDIT' || c.action === 'TOGGLE').length;
                    const deletes = entry.changes.filter((c) => c.action === 'DELETE').length;

                    return (
                      <div key={entry.id} className="relative pl-10 pb-6">
                        {/* Timeline dot */}
                        <div className={`absolute left-[10px] top-1.5 h-[11px] w-[11px] rounded-full border-2 border-background ${
                          entry.status === 'success' ? 'bg-green-500' : 'bg-red-500'
                        }`} />

                        {/* Entry content */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {new Date(entry.submittedAt).toLocaleDateString('fr-FR', {
                                day: 'numeric', month: 'short', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                            <span className="text-xs text-muted-foreground">by {entry.user}</span>
                            <div className="flex items-center gap-1">
                              {adds > 0 && <Badge className="bg-green-600 text-white text-[10px] py-0">+{adds}</Badge>}
                              {edits > 0 && <Badge className="bg-amber-600 text-white text-[10px] py-0">~{edits}</Badge>}
                              {deletes > 0 && <Badge className="bg-red-600 text-white text-[10px] py-0">-{deletes}</Badge>}
                            </div>
                          </div>

                          {/* Reason */}
                          <p className="text-sm text-muted-foreground italic">&ldquo;{entry.reason}&rdquo;</p>

                          {/* Diffs */}
                          <div className="space-y-1.5">
                            {entry.changes.map((change) => (
                              <ChangeDiffCard key={change.id} change={change} zoneName={zoneName} />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Bottom padding when pending bar is visible */}
      {pendingChanges.length > 0 && <div className="h-16" />}
      <ConfirmDialog />
    </div>
    </TooltipProvider>
  );
}
