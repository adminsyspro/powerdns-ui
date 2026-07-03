'use client';

import * as React from 'react';
import { ShieldCheck, BadgeCheck, Clock, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/stats';
import type { Certificate } from '@/lib/certs/types';

const DAY = 86400;
// Cert status is a reserved STATUS palette (not categorical identity): valid=good,
// pending=warning, expired=serious, error=critical — same hues as the row badges.
// The pending↔expired pair fails CVD separation (validator ΔE 2.1 deutan), so the
// donut ships a label+count legend as the required secondary encoding — identity is
// never by colour alone.
const STATUS_ORDER = ['valid', 'pending', 'expired', 'error'] as const;
const STATUS_COLOR: Record<string, string> = { valid: '#16a34a', pending: '#d97706', expired: '#ea580c', error: '#dc2626' };
const STATUS_LABEL: Record<string, string> = { valid: 'Valid', pending: 'Pending', expired: 'Expired', error: 'Error' };
// Expiry horizon is a single ordinal series → one hue (brand blue), magnitude by
// bar height, order by the x-axis. Deliberately NOT the status hues, so the same
// red/green never means two different things across the two adjacent charts.
const BAR_COLOR = '#3b82f6';

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
  color: 'hsl(var(--popover-foreground))',
} as const;
const TOOLTIP_ITEM = { color: 'hsl(var(--popover-foreground))' } as const;

export function CertsOverview({ certs }: { certs: Certificate[] }) {
  const m = React.useMemo(() => {
    const now = Date.now() / 1000;
    const total = certs.length;
    const valid = certs.filter((c) => c.status === 'valid').length;
    const expiringSoon = certs.filter(
      (c) => c.status === 'valid' && c.notAfter != null && c.notAfter > now && c.notAfter - now <= 30 * DAY
    ).length;
    const errors = certs.filter((c) => c.status === 'error' || c.renewalStatus === 'failed').length;

    const statusData = STATUS_ORDER
      .map((s) => ({ status: s, label: STATUS_LABEL[s], value: certs.filter((c) => c.status === s).length }))
      .filter((d) => d.value > 0);

    // Days-to-expiry buckets over issued (valid) certs.
    const labels = ['≤7d', '8–30d', '31–90d', '>90d'];
    const counts = [0, 0, 0, 0];
    for (const c of certs) {
      if (c.status !== 'valid' || c.notAfter == null) continue;
      const days = (c.notAfter - now) / DAY;
      if (days <= 7) counts[0]++;
      else if (days <= 30) counts[1]++;
      else if (days <= 90) counts[2]++;
      else counts[3]++;
    }
    const horizon = labels.map((bucket, i) => ({ bucket, count: counts[i] }));

    return { total, valid, expiringSoon, errors, statusData, horizon };
  }, [certs]);

  if (certs.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total" value={m.total} icon={ShieldCheck} />
        <StatCard title="Valid" value={m.valid} icon={BadgeCheck} description="active certificates" />
        <StatCard title="Expiring ≤30d" value={m.expiringSoon} icon={Clock} description="renew soon" />
        <StatCard title="Errors" value={m.errors} icon={AlertTriangle} description="error or failed renewal" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Status breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={m.statusData}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                      stroke="hsl(var(--background))"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {m.statusData.map((d) => <Cell key={d.status} fill={STATUS_COLOR[d.status]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* secondary encoding — identity via text label + count, never colour alone */}
              <ul className="space-y-1.5 text-sm">
                {m.statusData.map((d) => (
                  <li key={d.status} className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[d.status] }} />
                    <span className="text-muted-foreground">{d.label}</span>
                    <span className="font-medium tabular-nums">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Expiry horizon</CardTitle></CardHeader>
          <CardContent>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.horizon} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} className="text-muted-foreground" />
                  <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} className="text-muted-foreground" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
                  <Bar dataKey="count" name="Certificates" fill={BAR_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
