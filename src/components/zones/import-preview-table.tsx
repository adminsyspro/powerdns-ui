'use client';

import * as React from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { getRecordTypeColor } from '@/lib/utils';
import type { ImportPreview } from '@/lib/bind/types';

interface ImportPreviewTableProps {
  preview: ImportPreview;
}

export function ImportPreviewTable({ preview }: ImportPreviewTableProps) {
  const totalRecords = preview.rrsets.reduce((sum, rs) => sum + rs.records.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{preview.rrsets.length} RR sets</Badge>
        <Badge variant="secondary">{totalRecords} records</Badge>
        {preview.detectedOrigin && (
          <Badge variant="outline" className="font-mono text-[11px]">
            origin: {preview.detectedOrigin}
          </Badge>
        )}
        {preview.warnings.length > 0 && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {preview.warnings.length} warning{preview.warnings.length > 1 ? 's' : ''}
          </Badge>
        )}
        {preview.errors.length > 0 && (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300">
            <AlertCircle className="mr-1 h-3 w-3" />
            {preview.errors.length} error{preview.errors.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {preview.errors.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="py-3 space-y-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {preview.errors.length} line(s) will be skipped
            </p>
            <ScrollArea className="max-h-32">
              <ul className="text-xs text-red-700 dark:text-red-300 font-mono space-y-0.5">
                {preview.errors.map((e, i) => (
                  <li key={i}>line {e.line}: {e.message}</li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {preview.warnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardContent className="py-3 space-y-1">
            <ScrollArea className="max-h-32">
              <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w.line ? `line ${w.line}: ` : ''}{w.message}</li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {preview.rrsets.length > 0 && (
        <div className="border rounded-md">
          <div className="grid grid-cols-[1fr_80px_70px_2fr] gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground border-b">
            <div>Name</div>
            <div>Type</div>
            <div className="text-right">TTL</div>
            <div>Content</div>
          </div>
          <ScrollArea className="max-h-[300px]">
            <div className="divide-y">
              {preview.rrsets.map((rs, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_70px_2fr] gap-2 px-3 py-1.5 text-sm">
                  <div className="font-mono text-xs truncate">{rs.name}</div>
                  <div>
                    <Badge variant="outline" className={`${getRecordTypeColor(rs.type)} text-[10px]`}>
                      {rs.type}
                    </Badge>
                  </div>
                  <div className="text-right font-mono text-xs text-muted-foreground">{rs.ttl}</div>
                  <div className="font-mono text-xs truncate text-muted-foreground">
                    {rs.records.length > 1
                      ? `${rs.records[0].content} (+${rs.records.length - 1})`
                      : rs.records[0]?.content}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
