'use client';

import * as React from 'react';
import Link from 'next/link';
import { History, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChangeDiffCard } from '@/components/records/change-diff-card';
import { useServerConnectionStore } from '@/stores';
import * as api from '@/lib/api';
import type { ChangesetSubmission } from '@/types/powerdns';

export default function HistoryPage() {
  const { activeConnection } = useServerConnectionStore();
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<api.PaginatedHistory | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [selectedEntry, setSelectedEntry] = React.useState<ChangesetSubmission | null>(null);

  const fetchHistory = React.useCallback(async () => {
    if (!activeConnection) return;
    setIsLoading(true);
    const result = await api.fetchChangeHistory({ page, pageSize: 20 });
    if (result.data) setData(result.data);
    setIsLoading(false);
  }, [activeConnection, page]);

  React.useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Change History</h1>
        <p className="text-muted-foreground">Full audit trail of all DNS record changes with before/after diffs</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Changesets</CardTitle>
          <CardDescription>{data?.total || 0} total entries</CardDescription>
        </CardHeader>
        <CardContent>
          {!data || data.items.length === 0 ? (
            <div className="text-center py-12">
              <History className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No change history yet</h3>
              <p className="text-muted-foreground">Changes will appear here after you apply record modifications</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader className="bg-slate-100 dark:bg-slate-800">
                  <TableRow>
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold">Zone</TableHead>
                    <TableHead className="font-semibold">Changes</TableHead>
                    <TableHead className="font-semibold">Reason</TableHead>
                    <TableHead className="font-semibold">User</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((entry) => {
                    const adds = entry.changes.filter((c) => c.action === 'ADD').length;
                    const edits = entry.changes.filter((c) => c.action === 'EDIT' || c.action === 'TOGGLE').length;
                    const deletes = entry.changes.filter((c) => c.action === 'DELETE').length;
                    return (
                      <TableRow key={entry.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEntry(entry)}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(entry.submittedAt)}</TableCell>
                        <TableCell>
                          <Link href={`/zones/${encodeURIComponent(entry.zoneId)}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            {entry.zoneName.replace(/\.$/, '')}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {adds > 0 && <Badge className="bg-green-600 text-white text-[10px]">+{adds}</Badge>}
                            {edits > 0 && <Badge className="bg-amber-600 text-white text-[10px]">~{edits}</Badge>}
                            {deletes > 0 && <Badge className="bg-red-600 text-white text-[10px]">-{deletes}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{entry.reason}</TableCell>
                        <TableCell className="text-sm">{entry.user}</TableCell>
                        <TableCell>
                          {entry.status === 'success' ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
                              <CheckCircle2 className="h-3 w-3" />OK
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" />Error
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedEntry(entry)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page + 1)} disabled={page >= data.totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {selectedEntry && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Changeset — {selectedEntry.zoneName.replace(/\.$/, '')}
                  {selectedEntry.status === 'success' ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Success</Badge>
                  ) : (
                    <Badge variant="destructive">Error</Badge>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-2 rounded bg-muted/30 border">
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p>{formatDate(selectedEntry.submittedAt)}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/30 border">
                    <p className="text-xs text-muted-foreground">User</p>
                    <p>{selectedEntry.user}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/30 border">
                    <p className="text-xs text-muted-foreground">Changes</p>
                    <p>{selectedEntry.changes.length}</p>
                  </div>
                </div>

                <div className="p-2 rounded bg-muted/30 border">
                  <p className="text-xs text-muted-foreground">Reason</p>
                  <p>{selectedEntry.reason}</p>
                </div>

                {selectedEntry.errorMessage && (
                  <div className="p-2 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
                    <p className="text-xs font-medium">Error</p>
                    <p>{selectedEntry.errorMessage}</p>
                  </div>
                )}
              </div>

              <ScrollArea className="flex-1 -mx-6 px-6" style={{ maxHeight: '400px' }}>
                <div className="space-y-2 pt-2">
                  {selectedEntry.changes.map((change) => (
                    <ChangeDiffCard key={change.id} change={change} zoneName={selectedEntry.zoneName} />
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
