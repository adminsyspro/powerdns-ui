'use client';

import * as React from 'react';
import { ShieldCheck, BadgeCheck, Clock, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Certificate } from '@/lib/certs/types';

const DAY = 86400;
// Cert status is a reserved STATUS palette (not categorical identity): valid=good,
// pending=warning, expired=serious, error=critical — same hues as the row badges.
// Identity is never by colour alone: the Total donut ships a label+count legend as
// the required secondary encoding.
const STATUS_ORDER = ['valid', 'pending', 'expired', 'error'] as const;
const STATUS_COLOR: Record<string, string> = { valid: '#16a34a', pending: '#d97706', expired: '#ea580c', error: '#dc2626' };
const STATUS_LABEL: Record<string, string> = { valid: 'Valid', pending: 'Pending', expired: 'Expired', error: 'Error' };

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
  color: 'hsl(var(--popover-foreground))',
} as const;
const TOOLTIP_ITEM = { color: 'hsl(var(--popover-foreground))' } as const;

function Tile({
  title, value, icon: Icon, children,
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ElementType;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {children && <div className="mt-2">{children}</div>}
      </CardContent>
    </Card>
  );
}

export function CertsOverview({ certs }: { certs: Certificate[] }) {
  const m = React.useMemo(() => {
    const now = Date.now() / 1000;
    const total = certs.length;
    const statusCounts = {
      valid: certs.filter((c) => c.status === 'valid').length,
      pending: certs.filter((c) => c.status === 'pending').length,
      expired: certs.filter((c) => c.status === 'expired').length,
      error: certs.filter((c) => c.status === 'error').length,
    };
    const valid = statusCounts.valid;
    const pct = total ? Math.round((valid / total) * 100) : 0;
    const autoRenew = certs.filter((c) => c.autoRenew).length;

    // Expiry windows over valid, still-future certs.
    let soon7 = 0, soon30 = 0, nextDays = Infinity;
    for (const c of certs) {
      if (c.status !== 'valid' || c.notAfter == null) continue;
      const days = (c.notAfter - now) / DAY;
      if (days <= 0) continue;
      if (days < nextDays) nextDays = days;
      if (days <= 7) soon7++;
      else if (days <= 30) soon30++;
    }
    const expiringSoon = soon7 + soon30;

    // Error decomposition sums to `errors` (renew-failed excludes hard errors,
    // so a cert that is both is counted once, under "error").
    const erroredStatus = statusCounts.error;
    const renewFailedOnly = certs.filter((c) => c.renewalStatus === 'failed' && c.status !== 'error').length;
    const errors = erroredStatus + renewFailedOnly;

    const segments = STATUS_ORDER
      .map((s) => ({ status: s, label: STATUS_LABEL[s], value: statusCounts[s] }))
      .filter((d) => d.value > 0);

    return { total, valid, pct, autoRenew, soon7, soon30, expiringSoon, nextDays, erroredStatus, renewFailedOnly, errors, segments };
  }, [certs]);

  if (certs.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Total — status-composition donut (total in the centre) + counted legend. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total</CardTitle>
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="relative h-[84px] w-[84px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={m.segments}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={28}
                    outerRadius={40}
                    paddingAngle={2}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {m.segments.map((d) => <Cell key={d.status} fill={STATUS_COLOR[d.status]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold tabular-nums">{m.total}</span>
              </div>
            </div>
            {/* secondary encoding — identity via text label + count, never colour alone */}
            <ul className="space-y-1 text-xs">
              {m.segments.map((d) => (
                <li key={d.status} className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_COLOR[d.status] }} />
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="font-medium tabular-nums">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Valid — share of total, auto-renew coverage, and soonest expiry. */}
      <Tile title="Valid" value={m.valid} icon={BadgeCheck}>
        <p className="text-xs text-muted-foreground">
          {m.pct}% of total · {m.autoRenew} auto-renew
        </p>
        {Number.isFinite(m.nextDays) && (
          <p className="text-xs text-muted-foreground">next expiry in {Math.ceil(m.nextDays)}d</p>
        )}
      </Tile>

      {/* Expiring ≤30d — near-term urgency split. */}
      <Tile title="Expiring ≤30d" value={m.expiringSoon} icon={Clock}>
        <p className="text-xs text-muted-foreground">
          {m.expiringSoon === 0
            ? 'none within 30 days'
            : <><span className={m.soon7 > 0 ? 'text-amber-600 dark:text-amber-500 font-medium' : ''}>{m.soon7} within 7d</span> · {m.soon30} in 8–30d</>}
        </p>
      </Tile>

      {/* Errors — hard errors vs failed renewals (sums to the headline). */}
      <Tile title="Errors" value={m.errors} icon={AlertTriangle}>
        <p className="text-xs text-muted-foreground">
          {m.errors === 0
            ? 'all healthy'
            : <>{m.erroredStatus} error · {m.renewFailedOnly} renew-failed</>}
        </p>
      </Tile>
    </div>
  );
}
