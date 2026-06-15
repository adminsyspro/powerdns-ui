'use client';

import * as React from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { Activity, Gauge, Database, HeartPulse, WifiOff } from 'lucide-react';
import * as api from '@/lib/api';
import type { Server, ServerStatistic } from '@/types/powerdns';

// PowerDNS exposes only cumulative counters, so the graphs are built from
// in-session samples: poll /statistics, keep a ring buffer, derive rates from
// the deltas between consecutive samples. Nothing is persisted — the series
// resets on reload. See docs/superpowers/specs/2026-06-15-server-kpi-sparklines.
const POLL_MS = 3000;
const OFFLINE_POLL_MS = 15000;
const MAX_SAMPLES = 60; // ~3 min of history at POLL_MS
const OFFLINE_AFTER = 2; // consecutive failures before the offline state

interface Sample {
  t: number;
  queries?: number; // udp-queries + tcp-queries
  cacheHit?: number; // query-cache-hit + packetcache-hit
  cacheMiss?: number; // query-cache-miss + packetcache-miss
  latencyUs?: number; // latency (gauge, microseconds)
  uptime?: number; // seconds
  servfail?: number;
  corrupt?: number;
  timeout?: number;
}

type Status = 'loading' | 'ok' | 'offline';

function statMap(stats: ServerStatistic[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of stats) {
    // Skip ring/map statistics whose value is an array, not a scalar string.
    if (typeof s.value !== 'string') continue;
    const n = Number(s.value);
    if (!Number.isNaN(n)) m.set(s.name, n);
  }
  return m;
}

// Sum of the given counters; undefined when none of them are present (so a
// tile can degrade to "n/a" rather than reporting a misleading 0).
function sum(m: Map<string, number>, ...names: string[]): number | undefined {
  let total = 0;
  let found = false;
  for (const name of names) {
    const v = m.get(name);
    if (v !== undefined) {
      total += v;
      found = true;
    }
  }
  return found ? total : undefined;
}

function toSample(stats: ServerStatistic[]): Sample {
  const m = statMap(stats);
  return {
    t: Date.now(),
    queries: sum(m, 'udp-queries', 'tcp-queries'),
    cacheHit: sum(m, 'query-cache-hit', 'packetcache-hit'),
    cacheMiss: sum(m, 'query-cache-miss', 'packetcache-miss'),
    latencyUs: m.get('latency'),
    uptime: m.get('uptime'),
    servfail: m.get('servfail-packets'),
    corrupt: m.get('corrupt-packets'),
    timeout: m.get('timedout-packets'),
  };
}

function formatUptime(s?: number): string {
  if (s === undefined) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

interface Derived {
  qps: number | null;
  qpsSeries: number[];
  qpsAvailable: boolean;
  hitRatio: number | null; // percent
  hitSeries: number[];
  hitAvailable: boolean;
  latencyMs: number | null;
  latencySeries: number[];
  latencyAvailable: boolean;
  uptime?: number;
  servfail?: number;
  corrupt?: number;
  timeout?: number;
  hasErrorStats: boolean;
}

// Rate of a monotonic counter between two samples; null when the field is
// missing on either end, 0 when the counter went backwards (server restart).
function rate(prev?: number, curr?: number, dtMs?: number): number | null {
  if (prev === undefined || curr === undefined || !dtMs || dtMs <= 0) return null;
  const delta = curr - prev;
  if (delta < 0) return 0; // counter reset — skip the spike
  return delta / (dtMs / 1000);
}

function derive(samples: Sample[]): Derived {
  const last = samples[samples.length - 1];
  const qpsSeries: number[] = [];
  const hitSeries: number[] = [];
  const latencySeries: number[] = [];

  let lastHit: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Latency is a gauge — plot the raw value per sample.
    if (s.latencyUs !== undefined) latencySeries.push(s.latencyUs / 1000);

    if (i === 0) continue;
    const prev = samples[i - 1];
    const dt = s.t - prev.t;

    const q = rate(prev.queries, s.queries, dt);
    if (q !== null) qpsSeries.push(q);

    // Hit ratio over the interval (delta-based, not lifetime). When the server
    // was idle (no cache lookups), carry the previous ratio forward instead of
    // dropping to 0, which would be misleading.
    const dHit = rate(prev.cacheHit, s.cacheHit, dt);
    const dMiss = rate(prev.cacheMiss, s.cacheMiss, dt);
    if (dHit !== null && dMiss !== null) {
      const denom = dHit + dMiss;
      const ratio: number | null = denom > 0 ? (dHit / denom) * 100 : lastHit;
      if (ratio !== null) {
        hitSeries.push(ratio);
        lastHit = ratio;
      }
    }
  }

  return {
    qps: qpsSeries.length ? qpsSeries[qpsSeries.length - 1] : null,
    qpsSeries,
    // Availability reflects the latest sample: a stat the server never exposes
    // (Recursor / version drift) stays absent, so the tile can show "n/a"
    // instead of waiting for a series that will never arrive.
    qpsAvailable: last?.queries !== undefined,
    hitRatio: hitSeries.length ? hitSeries[hitSeries.length - 1] : null,
    hitSeries,
    hitAvailable: last?.cacheHit !== undefined && last?.cacheMiss !== undefined,
    latencyMs: latencySeries.length ? latencySeries[latencySeries.length - 1] : null,
    latencySeries,
    latencyAvailable: last?.latencyUs !== undefined,
    uptime: last?.uptime,
    servfail: last?.servfail,
    corrupt: last?.corrupt,
    timeout: last?.timeout,
    hasErrorStats:
      last?.servfail !== undefined || last?.corrupt !== undefined || last?.timeout !== undefined,
  };
}

// Headline text for a metric: "n/a" once we have data but the server does not
// expose the stat, "…" while still waiting for samples, else the formatted value.
function valueText(
  loaded: boolean,
  available: boolean,
  value: number | null,
  fmt: (v: number) => string
): string {
  if (loaded && !available) return 'n/a';
  if (value === null) return '…';
  return fmt(value);
}

function Sparkline({
  data,
  color,
  loaded,
  available,
}: {
  data: number[];
  color: string;
  loaded: boolean;
  available: boolean;
}) {
  if (loaded && !available) {
    return <div className="h-8 flex items-end text-[10px] text-muted-foreground">unavailable</div>;
  }
  if (data.length < 2) {
    return <div className="h-8 flex items-end text-[10px] text-muted-foreground">collecting…</div>;
  }
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Tile({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {children}
    </div>
  );
}

export function ServerStatsBlock({
  connectionId,
  serverId,
  fallbackVersion,
  actions,
}: {
  connectionId: string;
  serverId?: string;
  fallbackVersion?: string;
  actions?: React.ReactNode;
}) {
  const [serverInfo, setServerInfo] = React.useState<Server | null>(null);
  const [samples, setSamples] = React.useState<Sample[]>([]);
  const [status, setStatus] = React.useState<Status>('loading');

  // Server info: live version + daemon type (fixes the stale "Version unknown").
  React.useEffect(() => {
    let cancelled = false;
    api.fetchServerInfo(connectionId, serverId).then((res) => {
      if (!cancelled && res.data) setServerInfo(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, serverId]);

  // Statistics polling. A recursive timeout (not setInterval) lets us back off
  // when the server is unreachable and pause while the tab is hidden.
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;

    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      const res = await api.fetchStatistics(connectionId, serverId);
      if (cancelled) return;
      if (res.data) {
        failures = 0;
        setStatus('ok');
        setSamples((prev) => [...prev, toSample(res.data!)].slice(-MAX_SAMPLES));
        timer = setTimeout(poll, POLL_MS);
      } else {
        failures += 1;
        if (failures >= OFFLINE_AFTER) setStatus('offline');
        timer = setTimeout(poll, failures >= OFFLINE_AFTER ? OFFLINE_POLL_MS : POLL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connectionId, serverId]);

  const d = React.useMemo(() => derive(samples), [samples]);
  // True once at least one statistics poll has succeeded, so a still-absent
  // stat means "unavailable" rather than "not collected yet".
  const loaded = status === 'ok';

  const versionLine = (() => {
    if (serverInfo?.version) {
      const daemon = serverInfo.daemon_type ? `${serverInfo.daemon_type} ` : '';
      return `PowerDNS ${daemon}v${serverInfo.version}`;
    }
    if (status === 'offline') return 'Unreachable';
    if (fallbackVersion) return `v${fallbackVersion}`;
    return status === 'loading' ? 'Checking version…' : 'Version unknown';
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
          {status === 'offline' && <WifiOff className="h-3.5 w-3.5 text-destructive" />}
          {versionLine}
        </div>
        {actions}
      </div>

      {status === 'offline' ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground flex items-center gap-2">
          <WifiOff className="h-4 w-4" />
          Server unreachable — metrics paused, retrying…
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Queries / s"
            value={valueText(loaded, d.qpsAvailable, d.qps, (v) => v.toFixed(v < 10 ? 1 : 0))}
          >
            <Sparkline data={d.qpsSeries} color="#3b82f6" loaded={loaded} available={d.qpsAvailable} />
          </Tile>
          <Tile
            icon={<Database className="h-3.5 w-3.5" />}
            label="Cache hit"
            value={valueText(loaded, d.hitAvailable, d.hitRatio, (v) => `${v.toFixed(0)}%`)}
          >
            <Sparkline data={d.hitSeries} color="#22c55e" loaded={loaded} available={d.hitAvailable} />
          </Tile>
          <Tile
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Latency"
            value={valueText(loaded, d.latencyAvailable, d.latencyMs, (v) => `${v.toFixed(v < 10 ? 2 : 1)} ms`)}
          >
            <Sparkline data={d.latencySeries} color="#f59e0b" loaded={loaded} available={d.latencyAvailable} />
          </Tile>
          <Tile
            icon={<HeartPulse className="h-3.5 w-3.5" />}
            label="Uptime"
            value={formatUptime(d.uptime)}
          >
            <div className="text-[11px] text-muted-foreground leading-tight pt-1">
              {d.hasErrorStats ? (
                <>
                  servfail {d.servfail ?? 0} · corrupt {d.corrupt ?? 0} · timeout {d.timeout ?? 0}
                </>
              ) : (
                'no error counters'
              )}
            </div>
          </Tile>
        </div>
      )}
    </div>
  );
}
