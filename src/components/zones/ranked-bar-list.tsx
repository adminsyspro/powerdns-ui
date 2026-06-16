'use client';

import * as React from 'react';
import type { DnsBreakdownItem } from '@/lib/api';

const full = new Intl.NumberFormat('en');

// Ranked list with a proportional background bar per row (count / max). Reused by
// the DNS-analytics modal for the overview list, the data-center list, and every
// "queries by source" breakdown. Renders a muted "No data" when empty.
export function RankedBarList({
  title,
  items,
  max,
  footer,
}: {
  title?: string;
  items: DnsBreakdownItem[];
  // Optional shared denominator so sibling lists scale consistently; defaults to
  // this list's own top count.
  max?: number;
  footer?: string;
}) {
  const denom = Math.max(1, max ?? items[0]?.count ?? 1);
  return (
    <div className="space-y-1.5">
      {title ? <div className="text-xs font-medium text-muted-foreground">{title}</div> : null}
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No data</div>
      ) : (
        items.map((it, i) => (
          <div key={`${it.label}-${i}`} className="relative flex items-center justify-between gap-2 overflow-hidden rounded px-2 py-1 text-sm">
            <div
              className="absolute inset-y-0 left-0 bg-[#f6821f]/10"
              style={{ width: `${Math.round((it.count / denom) * 100)}%` }}
              aria-hidden
            />
            <span className="relative z-10 min-w-0 truncate">
              {it.label}
              {it.sublabel ? <span className="ml-1.5 text-xs text-muted-foreground">{it.sublabel}</span> : null}
            </span>
            <span className="relative z-10 tabular-nums text-muted-foreground">{full.format(it.count)}</span>
          </div>
        ))
      )}
      {footer ? <div className="pt-1 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
