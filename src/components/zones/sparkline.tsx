'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// Pure presentational unique-visitors sparkline: a small Cloudflare-orange area
// chart + the compact total, with an optional caption label. Used by the zone
// header and the zones-table column.
export function Sparkline({ points, total, label }: {
  points: Array<{ date: string; uniques: number }>;
  total: number;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-[110px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
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
        <span className="text-sm font-medium">{compact.format(total)}</span>
        {label ? <span className="text-[10px] text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}
