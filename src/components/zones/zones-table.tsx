'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Globe,
  Shield,
  Edit,
  Trash2,
  RefreshCw,
  Download,
  Copy,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ZoneListItem, ZoneKind } from '@/types/powerdns';
import { getZoneKindColor, formatSerial, formatRelativeTime, copyToClipboard } from '@/lib/utils';

interface ZonesTableProps {
  zones: ZoneListItem[];
  isLoading?: boolean;
  onDelete?: (zoneId: string) => void;
  onNotify?: (zoneId: string) => void;
  onExport?: (zoneId: string) => void;
  // Server-side pagination
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  // Server-side filters
  onSearchChange?: (search: string) => void;
  onKindChange?: (kind: string) => void;
  onDnssecChange?: (dnssec: string) => void;
  onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  searchValue?: string;
  kindValue?: string;
  dnssecValue?: string;
  // Whether pagination is server-side
  serverPagination?: boolean;
}

export function ZonesTable({
  zones,
  isLoading,
  onDelete,
  onNotify,
  onExport,
  total,
  page = 1,
  pageSize = 25,
  totalPages = 1,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
  onKindChange,
  onDnssecChange,
  onSortChange,
  sortBy = 'name',
  sortOrder = 'asc',
  searchValue = '',
  kindValue = 'all',
  dnssecValue = 'all',
  serverPagination = false,
}: ZonesTableProps) {
  // Local filter state for client-side mode
  const [localSearch, setLocalSearch] = React.useState('');
  const [localKind, setLocalKind] = React.useState<ZoneKind | 'all'>('all');
  const [localDnssec, setLocalDnssec] = React.useState<'all' | 'enabled' | 'disabled'>('all');

  // Debounce for search
  const searchTimerRef = React.useRef<NodeJS.Timeout>();
  const handleSearchInput = (value: string) => {
    if (serverPagination && onSearchChange) {
      setLocalSearch(value); // update input immediately
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => onSearchChange(value), 300);
    } else {
      setLocalSearch(value);
    }
  };

  // Displayed zones for client-side mode
  const displayedZones = serverPagination
    ? zones
    : zones.filter((zone) => {
        const matchesSearch = zone.name.toLowerCase().includes(localSearch.toLowerCase()) ||
          zone.account?.toLowerCase().includes(localSearch.toLowerCase());
        const matchesKind = localKind === 'all' || zone.kind === localKind;
        const matchesDnssec = localDnssec === 'all' ||
          (localDnssec === 'enabled' && zone.dnssec) ||
          (localDnssec === 'disabled' && !zone.dnssec);
        return matchesSearch && matchesKind && matchesDnssec;
      });

  const displayTotal = serverPagination ? (total || 0) : displayedZones.length;

  const SortHeader = ({ column, children }: { column: string; children: React.ReactNode }) => {
    if (!serverPagination || !onSortChange) {
      return <>{children}</>;
    }
    const isActive = sortBy === column;
    return (
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => {
          const newOrder = isActive && sortOrder === 'asc' ? 'desc' : 'asc';
          onSortChange(column, newOrder);
        }}
      >
        {children}
        {isActive ? (
          sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <Input
            placeholder="Search zones..."
            value={serverPagination ? (localSearch !== undefined ? localSearch : searchValue) : localSearch}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>
        <Select
          value={serverPagination ? kindValue : localKind}
          onValueChange={(value) => {
            if (serverPagination && onKindChange) {
              onKindChange(value === 'all' ? '' : value);
            } else {
              setLocalKind(value as ZoneKind | 'all');
            }
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Zone type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Native">Native</SelectItem>
            <SelectItem value="Master">Master</SelectItem>
            <SelectItem value="Slave">Slave</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={serverPagination ? dnssecValue : localDnssec}
          onValueChange={(value) => {
            if (serverPagination && onDnssecChange) {
              onDnssecChange(value === 'all' ? '' : value);
            } else {
              setLocalDnssec(value as 'all' | 'enabled' | 'disabled');
            }
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="DNSSEC" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="enabled">DNSSEC Enabled</SelectItem>
            <SelectItem value="disabled">DNSSEC Disabled</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">
          {displayTotal.toLocaleString()} zone{displayTotal !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader column="name">Zone Name</SortHeader></TableHead>
              <TableHead><SortHeader column="kind">Type</SortHeader></TableHead>
              <TableHead><SortHeader column="serial">Serial</SortHeader></TableHead>
              <TableHead><SortHeader column="dnssec">DNSSEC</SortHeader></TableHead>
              <TableHead><SortHeader column="account">Account</SortHeader></TableHead>
              <TableHead className="w-[160px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                </TableCell>
              </TableRow>
            ) : displayedZones.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Globe className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">No zones found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              displayedZones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell>
                    <Link
                      href={`/zones/${encodeURIComponent(zone.id)}`}
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{zone.name.replace(/\.$/, '')}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge className={getZoneKindColor(zone.kind)} variant="outline">{zone.kind}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{formatSerial(zone.serial)}</TableCell>
                  <TableCell>
                    {zone.dnssec ? (
                      <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <Shield className="h-3 w-3" />Enabled
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{zone.account || '-'}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <Link href={`/zones/${encodeURIComponent(zone.id)}`}>
                              <Edit className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(zone.name)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy name</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onExport?.(zone.id)}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Export</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete?.(zone.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {serverPagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Showing {((page - 1) * pageSize + 1).toLocaleString()}-{Math.min(page * pageSize, total || 0).toLocaleString()} of {(total || 0).toLocaleString()} zones
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange?.(parseInt(value))}
            >
              <SelectTrigger className="w-[80px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span>per page</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange?.(1)}
              disabled={page <= 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange?.(totalPages)}
              disabled={page >= totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
