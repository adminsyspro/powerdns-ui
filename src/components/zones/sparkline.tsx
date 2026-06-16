'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// Pure presentational sparkline: a small area chart + a value (compact total or an
// explicit `valueLabel`), with an optional caption label. `dataKey` selects which
// numeric field of each point to plot; `color` themes stroke + fill. Used by the
// zones-table column (defaults) and the zone-header traffic strip (per-metric).
export function Sparkline({ points, total, label, color = '#f6821f', dataKey = 'uniques', valueLabel, fluid = false }: {
  points: Array<Record<string, number | string>>;
  total: number;
  label?: string;
  color?: string;
  dataKey?: string;
  valueLabel?: string;
  // When true, the chart width is fluid (flex, shrinks to share available space)
  // instead of a fixed 110px — used by the responsive zone-header traffic strip.
  fluid?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${fluid ? 'min-w-0 flex-1' : ''}`}>
      <div className={fluid ? 'h-8 min-w-0 flex-1' : 'h-8 w-[110px]'}>
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
      <div className="flex flex-col leading-tight flex-shrink-0">
        <span className="text-sm font-medium">{valueLabel ?? compact.format(total)}</span>
        {label ? <span className="text-[10px] text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}
