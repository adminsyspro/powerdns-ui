'use client';

import * as React from 'react';
import { MoreHorizontal, Edit, Trash2, Copy, Power, PowerOff, MessageSquare, Plus, FileText, FileSpreadsheet, Download, Undo2, History } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import type { RRSet, RecordType, Comment, ChangeAction, PendingChange } from '@/types/powerdns';
import type { MergedRecord } from '@/lib/pending-changes-utils';
import { ChangeDiffCard } from '@/components/records/change-diff-card';
import { getRecordTypeColor, getRecordTypeRowColor, copyToClipboard, formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';

interface RecordsTableProps {
  records: RRSet[];
  zoneName: string;
  isLoading?: boolean;
  onEdit?: (record: RRSet) => void;
  onDelete?: (record: RRSet) => void;
  onToggle?: (record: RRSet, disabled: boolean) => void;
  onUpdateComment?: (record: RRSet, comment: string) => void;
  onAdd?: () => void;
  onCopyAll?: () => void;
  onExportText?: () => void;
  onExportCsv?: () => void;
  onExportPdf?: () => void;
  mergedRecords?: MergedRecord[];
  onUndoChange?: (changeId: string) => void;
  zoneId?: string;
}

const RECORD_TYPES: RecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'PTR', 'CAA', 'ALIAS', 'DNSKEY', 'DS', 'NAPTR', 'SSHFP', 'TLSA', 'URI'];

export function RecordsTable({ records, zoneName, isLoading, onEdit, onDelete, onToggle, onUpdateComment, onAdd, onCopyAll, onExportText, onExportCsv, onExportPdf, mergedRecords, onUndoChange, zoneId }: RecordsTableProps) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<RecordType | 'all'>('all');
  const [commentDialogOpen, setCommentDialogOpen] = React.useState(false);
  const [detailRecord, setDetailRecord] = React.useState<RRSet | null>(null);
  const [selectedRecord, setSelectedRecord] = React.useState<RRSet | null>(null);
  const [commentText, setCommentText] = React.useState('');
  const [historyData, setHistoryData] = React.useState<api.RRSetLastChange | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const handleOpenHistory = async (rrset: RRSet) => {
    if (!zoneId) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryData(null);
    const key = `${rrset.name}::${rrset.type}`;
    const result = await api.fetchRRSetLastChange(zoneId, key);
    setHistoryData(result.data || null);
    setHistoryLoading(false);
  };

  const TYPE_ORDER: Record<string, number> = {
    A: 0, AAAA: 1, CNAME: 2, MX: 3, TXT: 4, SRV: 5, CAA: 6, PTR: 7, NS: 8, SOA: 9, DS: 10, DNSKEY: 11,
  };

  const flatRecords = React.useMemo(() => {
    const source = mergedRecords || records.map((rrset) => ({ rrset } as MergedRecord));
    const result: Array<{ rrset: RRSet; record: { content: string; disabled: boolean }; index: number; pendingAction?: ChangeAction; changeId?: string }> = [];
    source.forEach(({ rrset, pendingAction, changeId }) => {
      rrset.records.forEach((record, index) => {
        result.push({ rrset, record, index, pendingAction, changeId });
      });
    });
    return result;
  }, [records, mergedRecords]);

  const filteredRecords = React.useMemo(() => {
    return flatRecords
      .filter(({ rrset, record }) => {
        const matchesSearch = rrset.name.toLowerCase().includes(searchTerm.toLowerCase()) || record.content.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = typeFilter === 'all' || rrset.type === typeFilter;
        return matchesSearch && matchesType;
      })
      .sort((a, b) => {
        const typeA = TYPE_ORDER[a.rrset.type] ?? 99;
        const typeB = TYPE_ORDER[b.rrset.type] ?? 99;
        if (typeA !== typeB) return typeA - typeB;
        return a.rrset.name.localeCompare(b.rrset.name);
      });
  }, [flatRecords, searchTerm, typeFilter]);

  const typeStats = React.useMemo(() => {
    const stats: Record<string, number> = {};
    flatRecords.forEach(({ rrset }) => { stats[rrset.type] = (stats[rrset.type] || 0) + 1; });
    return stats;
  }, [flatRecords]);

  const formatRecordName = (name: string) => {
    if (name === zoneName || name === `${zoneName}.`) return '@';
    return name.replace(`.${zoneName}`, '').replace(zoneName, '').replace(/\.$/, '') || '@';
  };

  const handleOpenCommentDialog = (rrset: RRSet) => {
    setSelectedRecord(rrset);
    setCommentText(rrset.comments?.[0]?.content || '');
    setCommentDialogOpen(true);
  };

  const handleSaveComment = () => {
    if (selectedRecord) {
      onUpdateComment?.(selectedRecord, commentText);
      setCommentDialogOpen(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(typeStats).sort(([, a], [, b]) => b - a).map(([type, count]) => (
              <Badge
                key={type}
                variant={typeFilter === type ? 'default' : 'outline'}
                className={`cursor-pointer text-xs ${typeFilter === type ? '' : getRecordTypeColor(type)}`}
                onClick={() => setTypeFilter(typeFilter === type ? 'all' : type as RecordType)}
              >
                {type}: {count}
              </Badge>
            ))}
            {typeFilter !== 'all' && (
              <Badge variant="outline" className="cursor-pointer text-xs" onClick={() => setTypeFilter('all')}>All</Badge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}</span>

            {/* Export buttons */}
            {onCopyAll && (
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCopyAll}><Copy className="h-3.5 w-3.5" /></Button>
              </TooltipTrigger><TooltipContent>Copy all</TooltipContent></Tooltip>
            )}
            {onExportText && (
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExportText}><FileText className="h-3.5 w-3.5" /></Button>
              </TooltipTrigger><TooltipContent>Export text</TooltipContent></Tooltip>
            )}
            {onExportCsv && (
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExportCsv}><FileSpreadsheet className="h-3.5 w-3.5" /></Button>
              </TooltipTrigger><TooltipContent>Export CSV</TooltipContent></Tooltip>
            )}
            {onExportPdf && (
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onExportPdf}><Download className="h-3.5 w-3.5" /></Button>
              </TooltipTrigger><TooltipContent>Export PDF</TooltipContent></Tooltip>
            )}

            <div className="w-px h-5 bg-border" />

            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as RecordType | 'all')}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {RECORD_TYPES.map((type) => (<SelectItem key={type} value={type}>{type} {typeStats[type] ? `(${typeStats[type]})` : ''}</SelectItem>))}
              </SelectContent>
            </Select>
            <Input placeholder="Search..." className="w-[180px] h-8 text-xs" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />

            {onAdd && (
              <>
                <div className="w-px h-5 bg-border" />
                <Button size="sm" className="h-8 text-xs" onClick={onAdd}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />Add Record
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader className="bg-slate-100 dark:bg-slate-800">
              <TableRow>
                <TableHead className="w-[180px] font-semibold text-slate-700 dark:text-slate-200">Name</TableHead>
                <TableHead className="w-[70px] font-semibold text-slate-700 dark:text-slate-200">Type</TableHead>
                <TableHead className="w-[70px] font-semibold text-slate-700 dark:text-slate-200">TTL</TableHead>
                <TableHead className="font-semibold text-slate-700 dark:text-slate-200">Content</TableHead>
                <TableHead className="w-[80px] font-semibold text-slate-700 dark:text-slate-200">Status</TableHead>
                <TableHead className="w-[40px] font-semibold text-slate-700 dark:text-slate-200">Comment</TableHead>
                <TableHead className="w-[140px] font-semibold text-slate-700 dark:text-slate-200">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center">Loading records...</TableCell></TableRow>
              ) : filteredRecords.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center">No records found</TableCell></TableRow>
              ) : (
                filteredRecords.map(({ rrset, record, index, pendingAction, changeId }) => {
                  const pendingBorder = pendingAction === 'ADD' ? 'border-l-4 border-l-green-500'
                    : pendingAction === 'EDIT' || pendingAction === 'TOGGLE' ? 'border-l-4 border-l-amber-500'
                    : pendingAction === 'DELETE' ? 'border-l-4 border-l-red-500 line-through opacity-60'
                    : '';
                  return (
                  <TableRow key={`${rrset.name}-${rrset.type}-${index}`} className={`${getRecordTypeRowColor(rrset.type)} ${pendingBorder} ${record.disabled && !pendingAction ? 'opacity-50' : ''} cursor-pointer`} onClick={() => setDetailRecord(rrset)}>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        {formatRecordName(rrset.name)}
                        {pendingAction === 'ADD' && <Badge className="bg-green-600 text-white text-[10px] px-1.5 py-0">NEW</Badge>}
                        {pendingAction === 'EDIT' && <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0">MODIFIED</Badge>}
                        {pendingAction === 'TOGGLE' && <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0">TOGGLED</Badge>}
                        {pendingAction === 'DELETE' && <Badge className="bg-red-600 text-white text-[10px] px-1.5 py-0">DELETED</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{rrset.type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rrset.ttl}</TableCell>
                    <TableCell className="text-sm max-w-md">
                      <Tooltip>
                        <TooltipTrigger className="truncate block max-w-full text-left font-mono">{record.content}</TooltipTrigger>
                        <TooltipContent className="max-w-lg"><p className="font-mono text-sm break-all">{record.content}</p></TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{record.disabled ? <Badge variant="secondary">Disabled</Badge> : <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {rrset.comments && rrset.comments.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenCommentDialog(rrset)}>
                              <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p className="max-w-[200px]">{rrset.comments[0].content}</p><p className="text-xs text-muted-foreground mt-1">by {rrset.comments[0].account}</p></TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-30 hover:opacity-100" onClick={() => handleOpenCommentDialog(rrset)}>
                          <MessageSquare className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit?.(rrset)}><Edit className="h-3.5 w-3.5" /></Button>
                        </TooltipTrigger><TooltipContent>Edit</TooltipContent></Tooltip>
                        <Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(record.content)}><Copy className="h-3.5 w-3.5" /></Button>
                        </TooltipTrigger><TooltipContent>Copy</TooltipContent></Tooltip>
                        <Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onToggle?.(rrset, !record.disabled)}>
                            {record.disabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                          </Button>
                        </TooltipTrigger><TooltipContent>{record.disabled ? 'Enable' : 'Disable'}</TooltipContent></Tooltip>
                        {zoneId && (
                          <Tooltip><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenHistory(rrset)}><History className="h-3.5 w-3.5" /></Button>
                          </TooltipTrigger><TooltipContent>Last change</TooltipContent></Tooltip>
                        )}
                        <Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete?.(rrset)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
                        {pendingAction && changeId && onUndoChange && (
                          <Tooltip><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-600" onClick={() => onUndoChange(changeId)}><Undo2 className="h-3.5 w-3.5" /></Button>
                          </TooltipTrigger><TooltipContent>Undo</TooltipContent></Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Comment Dialog */}
        <Dialog open={commentDialogOpen} onOpenChange={setCommentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Comment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {selectedRecord && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge className={getRecordTypeColor(selectedRecord.type)}>{selectedRecord.type}</Badge>
                    <span className="font-mono">{formatRecordName(selectedRecord.name)}</span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground mt-1 truncate">{selectedRecord.records[0]?.content}</p>
                </div>
              )}
              <div className="space-y-2">
                <Textarea placeholder="Add a comment to this record..." value={commentText} onChange={(e) => setCommentText(e.target.value)} rows={3} />
                <p className="text-xs text-muted-foreground">Comments help document the purpose of records</p>
              </div>
              {selectedRecord?.comments?.[0] && (
                <p className="text-xs text-muted-foreground">Last updated by {selectedRecord.comments[0].account} on {formatDateTime(selectedRecord.comments[0].modified_at * 1000)}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCommentDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveComment}>Save Comment</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail Dialog */}
        <Dialog open={!!detailRecord} onOpenChange={(open) => { if (!open) setDetailRecord(null); }}>
          <DialogContent className="max-w-lg">
            {detailRecord && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Badge className={getRecordTypeColor(detailRecord.type)}>{detailRecord.type}</Badge>
                    <span className="font-mono">{formatRecordName(detailRecord.name)}</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Records */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Values</p>
                    <div className="space-y-1.5">
                      {detailRecord.records.map((rec, i) => (
                        <div key={i} className={`flex items-center justify-between p-2.5 rounded-md border ${rec.disabled ? 'opacity-50 bg-muted' : 'bg-muted/30'}`}>
                          <span className="font-mono text-sm break-all">{rec.content}</span>
                          <Badge variant={rec.disabled ? 'secondary' : 'default'} className={rec.disabled ? '' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}>
                            {rec.disabled ? 'Disabled' : 'Active'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-2.5 rounded-md bg-muted/30 border">
                      <p className="text-muted-foreground text-xs">Full Name</p>
                      <p className="font-mono mt-0.5">{detailRecord.name}</p>
                    </div>
                    <div className="p-2.5 rounded-md bg-muted/30 border">
                      <p className="text-muted-foreground text-xs">TTL</p>
                      <p className="font-mono mt-0.5">{detailRecord.ttl}s</p>
                    </div>
                    <div className="p-2.5 rounded-md bg-muted/30 border">
                      <p className="text-muted-foreground text-xs">Type</p>
                      <p className="font-mono mt-0.5">{detailRecord.type}</p>
                    </div>
                    <div className="p-2.5 rounded-md bg-muted/30 border">
                      <p className="text-muted-foreground text-xs">Records</p>
                      <p className="font-mono mt-0.5">{detailRecord.records.length}</p>
                    </div>
                  </div>

                  {/* Comment */}
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-muted-foreground">Comment</p>
                    {detailRecord.comments && detailRecord.comments.length > 0 ? (
                      <div className="p-2.5 rounded-md bg-muted/30 border text-sm">
                        <p>{detailRecord.comments[0].content}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          by {detailRecord.comments[0].account} &bull; {formatDateTime(detailRecord.comments[0].modified_at * 1000)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No comment</p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDetailRecord(null)}>Close</Button>
                  <Button onClick={() => { onEdit?.(detailRecord); setDetailRecord(null); }}>Edit</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
        {/* RRSet History Dialog */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Last Change</DialogTitle>
            </DialogHeader>
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
            ) : historyData && historyData.found && historyData.change ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="p-2 rounded bg-muted/30 border">
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p>{new Date(historyData.submittedAt!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/30 border">
                    <p className="text-xs text-muted-foreground">User</p>
                    <p>{historyData.user}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/30 border">
                    <p className="text-xs text-muted-foreground">Action</p>
                    <p>{historyData.change.action}</p>
                  </div>
                </div>
                <div className="p-2 rounded bg-muted/30 border text-sm">
                  <p className="text-xs text-muted-foreground">Reason</p>
                  <p>{historyData.reason}</p>
                </div>
                <ChangeDiffCard change={historyData.change} zoneName={zoneName} />
              </div>
            ) : (
              <div className="text-center py-8">
                <History className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">No change history for this record</p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
