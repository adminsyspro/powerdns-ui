'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import * as api from '@/lib/api';
import type { ZoneAnalytics } from '@/lib/api';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// Cloudflare-orange traffic sparkline (unique visitors, 30d). Self-gating: it
// renders nothing for non-replicated zones (and while loading), a muted
// "No data" for replicated zones without analytics, and the chart otherwise.
export function ZoneTrafficSparkline({ zoneName }: { zoneName: string }) {
  const [state, setState] = React.useState<ZoneAnalytics | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    api.fetchZoneAnalytics(zoneName).then((result) => {
      if (cancelled) return;
      setState(result.data ?? { linked: false });
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [zoneName]);

  if (!loaded || !state?.linked) return null;

  if (!state.available || !state.points || state.points.length === 0) {
    return (
      <>
        <div className="w-px h-5 bg-border" />
        <span className="text-xs text-muted-foreground">No data</span>
      </>
    );
  }

  return (
    <>
      <div className="w-px h-5 bg-border" />
      <div className="flex items-center gap-2">
        <div className="h-8 w-[110px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={state.points} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <Area
                type="monotone"
                dataKey="uniques"
                stroke="#f6821f"
                fill="#f6821f"
                fillOpacity={0.15}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium">{compact.format(state.total ?? 0)}</span>
          <span className="text-[10px] text-muted-foreground">unique visitors · 30d</span>
        </div>
      </div>
    </>
  );
}
