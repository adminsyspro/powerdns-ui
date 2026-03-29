'use client';

import * as React from 'react';
import { Globe, FileText, Shield, Server, TrendingUp, TrendingDown, Clock, Zap, HardDrive, Activity as ActivityIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

// ---- Stat Card ----

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  trend?: { value: number; isPositive: boolean };
  sparklineData?: number[];
  sparklineColor?: string;
  className?: string;
}

export function StatCard({ title, value, description, icon: Icon, trend, sparklineData, sparklineColor = '#3b82f6', className }: StatCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sparklineData && sparklineData.length >= 2 && (
          <div className="h-8 mt-1 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData.map((v, i) => ({ v, i }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`spark-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={sparklineColor} strokeWidth={1.5} fill={`url(#spark-${title.replace(/\s/g, '')})`} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {(description || trend) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {trend && (
              <span className={cn('flex items-center', trend.isPositive ? 'text-green-600' : 'text-red-600')}>
                {trend.isPositive ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
                {trend.value}%
              </span>
            )}
            {description && <span>{description}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Dashboard Stats (zone stats + server stats) ----

interface DashboardStatsProps {
  stats: {
    totalZones: number;
    dnssecEnabled: number;
    nativeZones: number;
    masterZones: number;
    slaveZones: number;
  };
  serverStats?: Record<string, string>;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const MAX_HISTORY = 20;

function useSparklineHistory(value: number): number[] {
  const historyRef = React.useRef<number[]>([]);

  React.useEffect(() => {
    if (value > 0) {
      const h = historyRef.current;
      if (h.length === 0 || h[h.length - 1] !== value) {
        historyRef.current = [...h.slice(-(MAX_HISTORY - 1)), value];
      }
    }
  }, [value]);

  return historyRef.current;
}

export function DashboardStats({ stats, serverStats = {} }: DashboardStatsProps) {
  const s = (key: string) => Number.parseInt(serverStats[key] || '0') || 0;
  const dnssecPercentage = stats.totalZones > 0 ? Math.round((stats.dnssecEnabled / stats.totalZones) * 100) : 0;
  const totalQueries = s('udp-queries') + s('tcp-queries');
  const uptime = s('uptime');
  const memory = s('real-memory-usage');
  const packetHits = s('packetcache-hit');
  const packetMisses = s('packetcache-miss');
  const cacheRate = (packetHits + packetMisses) > 0
    ? Math.round((packetHits / (packetHits + packetMisses)) * 100)
    : 0;
  const latency = serverStats['latency'] || '0';

  const memoryHistory = useSparklineHistory(memory);
  const cacheHistory = useSparklineHistory(cacheRate);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard
        title="Total Zones"
        value={stats.totalZones.toLocaleString()}
        description={`${stats.nativeZones} native, ${stats.masterZones} master, ${stats.slaveZones} slave`}
        icon={Globe}
      />
      <StatCard
        title="Total Queries"
        value={totalQueries > 0 ? formatNumber(totalQueries) : '-'}
        description={totalQueries > 0 ? `${formatNumber(s('udp-queries'))} UDP / ${formatNumber(s('tcp-queries'))} TCP` : 'No data'}
        icon={FileText}
      />
      <StatCard
        title="DNSSEC Enabled"
        value={stats.dnssecEnabled}
        description={`${dnssecPercentage}% of zones`}
        icon={Shield}
      />
      <StatCard
        title="Uptime"
        value={uptime > 0 ? formatUptime(uptime) : '-'}
        description={cacheRate > 0 ? `Cache hit: ${cacheRate}%` : ''}
        icon={Clock}
      />
      <StatCard
        title="Memory"
        value={memory > 0 ? formatBytes(memory) : '-'}
        description={`Latency: ${latency}ms`}
        icon={HardDrive}
        sparklineData={memoryHistory}
        sparklineColor="#6366f1"
      />
      <StatCard
        title="Cache Hit Rate"
        value={cacheRate > 0 ? `${cacheRate}%` : '-'}
        description={packetHits > 0 ? `${formatNumber(packetHits)} hits / ${formatNumber(packetMisses)} misses` : ''}
        icon={Zap}
        sparklineData={cacheHistory}
        sparklineColor="#22c55e"
      />
    </div>
  );
}

// ---- Zone Type Pie Chart ----

export function ZoneTypeChart({ native, master, slave }: { native: number; master: number; slave: number }) {
  const data = [
    { name: 'Native', value: native, color: '#10b981' },
    { name: 'Master', value: master, color: '#3b82f6' },
    { name: 'Slave', value: slave, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Zone Distribution</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-[180px]">
          <p className="text-muted-foreground text-sm">No zone data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Zone Distribution</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {data.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Server Metrics ----

interface ServerMetricsProps {
  serverStats: Record<string, string>;
}

function MetricRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">{formatNumber(value)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function ServerMetricsChart({ serverStats }: ServerMetricsProps) {
  const s = (key: string) => Number.parseInt(serverStats[key] || '0') || 0;

  const metrics = [
    { label: 'UDP Queries', value: s('udp-queries'), color: '#3b82f6' },
    { label: 'TCP Queries', value: s('tcp-queries'), color: '#6366f1' },
    { label: 'UDP Answers', value: s('udp-answers'), color: '#22c55e' },
    { label: 'TCP Answers', value: s('tcp-answers'), color: '#10b981' },
    { label: 'Backend Queries', value: s('backend-queries'), color: '#f59e0b' },
    { label: 'SERVFAIL', value: s('servfail-packets'), color: '#ef4444' },
  ].filter(m => m.value > 0);

  const max = Math.max(...metrics.map(m => m.value), 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Query Metrics</CardTitle>
        <CardDescription>Server query and answer breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        {metrics.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">No query data available</p>
          </div>
        ) : (
          <div className="space-y-4">
            {metrics.map((m) => (
              <MetricRow key={m.label} label={m.label} value={m.value} max={max} color={m.color} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Cache Performance ----

function CacheRing({ label, hits, misses }: { label: string; hits: number; misses: number }) {
  const total = hits + misses;
  const rate = total > 0 ? Math.round((hits / total) * 100) : 0;
  const data = [
    { name: 'Hits', value: hits },
    { name: 'Misses', value: misses },
  ];
  const COLORS = ['#22c55e', '#e5e7eb'];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-[140px] w-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={60}
              paddingAngle={2}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{rate}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {formatNumber(hits)} hits / {formatNumber(misses)} misses
        </p>
      </div>
    </div>
  );
}

export function CachePerformanceChart({ serverStats }: ServerMetricsProps) {
  const s = (key: string) => Number.parseInt(serverStats[key] || '0') || 0;

  const packetHits = s('packetcache-hit');
  const packetMisses = s('packetcache-miss');
  const queryHits = s('query-cache-hit');
  const queryMisses = s('query-cache-miss');
  const hasData = (packetHits + packetMisses + queryHits + queryMisses) > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Cache Performance</CardTitle>
        <CardDescription>Hit rate for packet and query caches</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">No cache data available</p>
          </div>
        ) : (
          <div className="flex items-center justify-evenly py-2">
            <CacheRing label="Packet Cache" hits={packetHits} misses={packetMisses} />
            <CacheRing label="Query Cache" hits={queryHits} misses={queryMisses} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Activity Chart from real logs ----

interface ActivityChartProps {
  logs: Array<{ action: string; timestamp: Date }>;
}

export function ActivityChart({ logs }: ActivityChartProps) {
  const data = React.useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();
    const result: Array<{ day: string; created: number; updated: number; deleted: number; other: number }> = [];

    // Last 7 days
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayName = days[d.getDay()];
      const dateStr = d.toISOString().slice(0, 10);

      const dayLogs = logs.filter(l => {
        const logDate = new Date(l.timestamp).toISOString().slice(0, 10);
        return logDate === dateStr;
      });

      result.push({
        day: dayName,
        created: dayLogs.filter(l => l.action.toLowerCase().includes('creat')).length,
        updated: dayLogs.filter(l => l.action.toLowerCase().includes('updat')).length,
        deleted: dayLogs.filter(l => l.action.toLowerCase().includes('delet')).length,
        other: dayLogs.filter(l => {
          const a = l.action.toLowerCase();
          return !a.includes('creat') && !a.includes('updat') && !a.includes('delet');
        }).length,
      });
    }

    return result;
  }, [logs]);

  const hasData = data.some(d => d.created + d.updated + d.deleted + d.other > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Weekly Activity</CardTitle>
        <CardDescription>{hasData ? 'Actions over the last 7 days' : 'No activity in the last 7 days'}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex items-center justify-center h-[250px]">
            <div className="text-center">
              <ActivityIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-muted-foreground text-sm">Activity will appear here as you manage zones and records</p>
            </div>
          </div>
        ) : (
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                <Legend />
                <Bar dataKey="created" name="Created" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="updated" name="Updated" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="deleted" name="Deleted" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="other" name="Other" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Server Info Card ----

interface ServerInfoProps {
  serverStats: Record<string, string>;
}

export function ServerInfoCard({ serverStats }: ServerInfoProps) {
  const s = (key: string) => Number.parseInt(serverStats[key] || '0') || 0;
  const uptime = s('uptime');
  const memory = s('real-memory-usage');
  const fdUsage = s('fd-usage');
  const latency = serverStats['latency'] || '0';
  const servfail = s('servfail-packets');
  const timedout = s('timedout-packets');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Server Health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>Uptime</span>
          </div>
          <span className="font-mono text-sm">{uptime > 0 ? formatUptime(uptime) : '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <span>Memory</span>
          </div>
          <span className="font-mono text-sm">{memory > 0 ? formatBytes(memory) : '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span>Avg Latency</span>
          </div>
          <span className="font-mono text-sm">{latency}ms</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span>File Descriptors</span>
          </div>
          <span className="font-mono text-sm">{fdUsage || '-'}</span>
        </div>
        {(servfail > 0 || timedout > 0) && (
          <>
            <div className="border-t pt-2 mt-2" />
            {servfail > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-600">SERVFAIL</span>
                <span className="font-mono text-sm text-red-600">{servfail.toLocaleString()}</span>
              </div>
            )}
            {timedout > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-600">Timed Out</span>
                <span className="font-mono text-sm text-amber-600">{timedout.toLocaleString()}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
