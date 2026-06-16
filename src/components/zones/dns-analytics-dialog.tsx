'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import * as api from '@/lib/api';
import type { ZoneDnsAnalytics, DnsAnalyticsRange, DnsBreakdownItem } from '@/lib/api';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RankedBarList } from '@/components/zones/ranked-bar-list';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

const RANGE_LABELS: Record<DnsAnalyticsRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

// Overview dimension toggle: which breakdown drives the top-5 list. The timeline
// below ALWAYS shows total queries and never changes with this selection.
const OVERVIEW_DIMS: Array<{ key: keyof NonNullable<ZoneDnsAnalytics['breakdowns']>; label: string }> = [
  { key: 'queryName', label: 'Query name' },
  { key: 'recordType', label: 'Query type' },
  { key: 'responseCode', label: 'Response code' },
  { key: 'dataCenter', label: 'Data center' },
  { key: 'sourceIp', label: 'Source IP' },
  { key: 'destinationIp', label: 'Destination IP' },
];

export function DnsAnalyticsDialog({
  zone,
  open,
  onOpenChange,
}: {
  zone: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [range, setRange] = React.useState<DnsAnalyticsRange>('24h');
  const [dim, setDim] = React.useState<keyof NonNullable<ZoneDnsAnalytics['breakdowns']>>('queryName');
  const [data, setData] = React.useState<ZoneDnsAnalytics | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !zone) return;
    let cancelled = false;
    setLoading(true);
    api.fetchZoneDnsAnalytics(zone, range).then((result) => {
      if (cancelled) return;
      setData(result.data ?? { linked: false });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, zone, range]);

  const fmtTick = (ts: string) => {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return range === '24h'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const available = !!data?.available;
  const b = data?.breakdowns;
  const overviewItems: DnsBreakdownItem[] = (b?.[dim] ?? []).slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>DNS queries for {zone ?? ''}</DialogTitle>
              <DialogDescription>Cloudflare DNS analytics for this replicated zone.</DialogDescription>
            </div>
            <Select value={range} onValueChange={(v) => setRange(v as DnsAnalyticsRange)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">{RANGE_LABELS['24h']}</SelectItem>
                <SelectItem value="7d">{RANGE_LABELS['7d']}</SelectItem>
                <SelectItem value="30d">{RANGE_LABELS['30d']}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-6">
            <div className="h-40 w-full animate-pulse rounded bg-muted" />
            <div className="h-20 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : !data?.linked ? (
          <div className="py-10 text-center text-sm text-muted-foreground">This zone is not replicated to Cloudflare.</div>
        ) : !available ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No DNS data available for this zone.</div>
        ) : (
          <div className="space-y-6">
            {/* 1. Query overview */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {OVERVIEW_DIMS.map((d) => (
                  <Button
                    key={d.key}
                    variant={dim === d.key ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setDim(d.key)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
              <RankedBarList items={overviewItems} />
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="ts" tickFormatter={fmtTick} tick={{ fontSize: 11 }} minTickGap={32} />
                    <YAxis tick={{ fontSize: 11 }} width={40} allowDecimals={false} />
                    <RTooltip
                      labelFormatter={(l) => fmtTick(String(l))}
                      formatter={(v: number) => [v, 'Queries']}
                    />
                    <Area type="monotone" dataKey="count" stroke="#f6821f" fill="#f6821f" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">Timeline shows total queries per interval (all dimensions).</p>
            </section>

            {/* 2. Query statistics */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Total queries" value={compact.format(data.totalQueries ?? 0)} />
              <Stat label="Average queries per second" value={(data.avgQps ?? 0).toFixed(3)} />
              {data.avgProcessingMs != null ? (
                <Stat label="Average processing time (ms)" value={data.avgProcessingMs.toFixed(3)} />
              ) : null}
            </section>

            {/* 3. Data centers */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">DNS queries by data center</h3>
              <RankedBarList items={(b?.dataCenter ?? []).slice(0, 10)} footer={`Top ${Math.min(10, b?.dataCenter?.length ?? 0)} data centers`} />
            </section>

            {/* 4. Queries by source */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Queries by source</h3>
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <RankedBarList title="DNS record" items={(b?.dnsRecord ?? []).slice(0, 5)} />
                <RankedBarList title="Query name" items={(b?.queryName ?? []).slice(0, 5)} />
                <RankedBarList title="Response code" items={(b?.responseCode ?? []).slice(0, 5)} />
                <RankedBarList title="Record type" items={(b?.recordType ?? []).slice(0, 5)} />
                <RankedBarList title="Source IP" items={(b?.sourceIp ?? []).slice(0, 5)} />
                <RankedBarList title="Destination IP" items={(b?.destinationIp ?? []).slice(0, 5)} />
                <RankedBarList title="Transport protocol" items={(b?.transport ?? []).slice(0, 5)} />
                <RankedBarList title="IP version" items={(b?.ipVersion ?? []).slice(0, 5)} />
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
