'use client';

import * as React from 'react';
import * as api from '@/lib/api';
import type { ZoneTraffic } from '@/lib/api';
import { Sparkline } from '@/components/zones/sparkline';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Five Cloudflare traffic sparklines for the zone header. Self-gating: renders
// nothing for non-replicated zones and while loading, a muted "No data" for
// replicated zones without analytics, and the strip otherwise.
export function ZoneTrafficSparklines({ zoneName }: { zoneName: string }) {
  const [state, setState] = React.useState<ZoneTraffic | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    api.fetchZoneTraffic(zoneName).then((result) => {
      if (cancelled) return;
      setState(result.data ?? { linked: false });
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [zoneName]);

  if (!loaded || !state?.linked) return null;

  if (!state.available || !state.points || state.points.length === 0 || !state.totals) {
    return <span className="text-xs text-muted-foreground">No data</span>;
  }

  const points = state.points;
  const t = state.totals;
  const cachedPctTotal = t.requests ? Math.round((t.cachedRequests / t.requests) * 100) : 0;
  // Build a fresh {date, v} series per metric. Anonymous object arrays are
  // assignable to Sparkline's `points` type; the named ZoneTrafficPoint interface
  // would not be (no implicit index signature).
  const mk = (sel: (p: (typeof points)[number]) => number) => points.map((p) => ({ date: p.date, v: sel(p) }));

  const metrics = [
    { data: mk((p) => p.uniques), total: t.uniques, valueLabel: compact.format(t.uniques), label: 'Unique visitors', color: '#f6821f' },
    { data: mk((p) => p.requests), total: t.requests, valueLabel: compact.format(t.requests), label: 'Total requests', color: '#3b82f6' },
    { data: mk((p) => (p.requests ? (p.cachedRequests / p.requests) * 100 : 0)), total: cachedPctTotal, valueLabel: `${cachedPctTotal}%`, label: '% Cached', color: '#22c55e' },
    { data: mk((p) => p.bytes), total: t.bytes, valueLabel: formatBytes(t.bytes), label: 'Data served', color: '#a855f7' },
    { data: mk((p) => p.cachedBytes), total: t.cachedBytes, valueLabel: formatBytes(t.cachedBytes), label: 'Data cached', color: '#06b6d4' },
  ];

  // Fill the available width: the parent reserves a flex-1 middle zone between the
  // zone switcher and the action buttons. The five charts share that width via
  // equal flex-1 columns, so they adapt to any screen — wider → wider charts,
  // narrower → narrower — and never wrap.
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      {metrics.map((m, i) => (
        <React.Fragment key={m.label}>
          {i > 0 ? <div className="w-px h-5 bg-border flex-shrink-0" /> : null}
          <Sparkline points={m.data} total={m.total} valueLabel={m.valueLabel} label={m.label} color={m.color} dataKey="v" fluid />
        </React.Fragment>
      ))}
    </div>
  );
}
