'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// Pure presentational sparkline: a small area chart + a value (compact total or an
// explicit `valueLabel`), with an optional caption label. `dataKey` selects which
// numeric field of each point to plot; `color` themes stroke + fill. Used by the
// zones-table column (defaults) and the zone-header traffic strip (per-metric).
export function Sparkline({ points, total, label, color = '#f6821f', dataKey = 'uniques', valueLabel }: {
  points: Array<Record<string, number | string>>;
  total: number;
  label?: string;
  color?: string;
  dataKey?: string;
  valueLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-[110px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              fill={color}
              fillOpacity={0.15}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium">{valueLabel ?? compact.format(total)}</span>
        {label ? <span className="text-[10px] text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}
