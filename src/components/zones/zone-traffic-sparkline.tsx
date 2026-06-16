'use client';

import * as React from 'react';
import * as api from '@/lib/api';
import type { ZoneAnalytics } from '@/lib/api';
import { Sparkline } from '@/components/zones/sparkline';

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
      <Sparkline points={state.points} total={state.total ?? 0} label="unique visitors · 30d" />
    </>
  );
}
