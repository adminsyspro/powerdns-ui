'use client';

import * as React from 'react';
import Link from 'next/link';
import { Globe, ArrowRight, Shield, Activity, Server, AlertCircle, Loader2, Radio, AlertTriangle, Wifi } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DashboardStats,
  ZoneTypeChart,
  ServerMetricsChart,
  CachePerformanceChart,
  ActivityChart,
  StatCard,
} from '@/components/dashboard/stats';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useServerConnectionStore, useActivityLogStore } from '@/stores';
import { useCachedZoneStats, useCachedZones, useStatistics, statsToMap } from '@/hooks/use-pdns';
import { formatRelativeTime, getZoneKindColor } from '@/lib/utils';

export default function DashboardPage() {
  const { activeConnection, connections } = useServerConnectionStore();
  const { logs, getRecentLogs } = useActivityLogStore();
  const { data: zoneStats, isLoading: statsLoading } = useCachedZoneStats();
  const { data: recentZonesData } = useCachedZones({ page: 1, pageSize: 5, sortBy: 'serial', sortOrder: 'desc' });
  const { data: statistics } = useStatistics();

  const serverStats = statsToMap(statistics);
  const recentLogs = getRecentLogs(5);
  const recentZones = recentZonesData?.items || [];

  // Proxy stats
  interface ProxyStats {
    requests: { today: number; week: number; month: number };
    errors: { today: number; week: number };
    statusBreakdown: { success: number; clientError: number; serverError: number };
    topIps: Array<{ ip: string; count: number }>;
    topZones: Array<{ zone: string; count: number }>;
    topAccesses: Array<{ name: string; count: number }>;
    daily: Array<{ date: string; requests: number; errors: number }>;
  }
  const [proxyStats, setProxyStats] = React.useState<ProxyStats | null>(null);

  React.useEffect(() => {
    fetch('/api/proxy/stats')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setProxyStats(data); })
      .catch(() => {});
  }, []);

  const computedStats = React.useMemo(() => {
    if (!zoneStats) return null;
    return {
      totalZones: zoneStats.total,
      dnssecEnabled: zoneStats.dnssecEnabled,
      nativeZones: zoneStats.native,
      masterZones: zoneStats.master,
      slaveZones: zoneStats.slave,
    };
  }, [zoneStats]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your PowerDNS infrastructure</p>
      </div>

      {!activeConnection && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">No PowerDNS server connected</p>
                <p className="text-sm text-amber-600 dark:text-amber-400">Configure a server connection to manage your DNS zones</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href="/servers"><Server className="mr-2 h-4 w-4" />Add Server</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {statsLoading && activeConnection && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Loading data from PowerDNS...</span>
        </div>
      )}

      {/* Row 1: Key stats */}
      {computedStats && <DashboardStats stats={computedStats} serverStats={serverStats} />}

      {/* Row 2: Query metrics + Cache performance */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ServerMetricsChart serverStats={serverStats} />
        <CachePerformanceChart serverStats={serverStats} />
      </div>

      {/* Row 3: Recent zones + Zone distribution */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Recent Zones</CardTitle>
              <CardDescription>Latest modified DNS zones</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/zones">View all<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentZones.length === 0 && !statsLoading ? (
              <p className="text-muted-foreground text-center py-4">No zones found</p>
            ) : (
              <div className="space-y-2">
                {recentZones.map((zone) => (
                  <div key={zone.id} className="flex items-center justify-between rounded-lg border p-2 transition-colors hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <Link href={`/zones/${encodeURIComponent(zone.id)}`} className="text-sm font-medium hover:underline">{zone.name}</Link>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className={`${getZoneKindColor(zone.kind)} text-[10px] px-1.5 py-0`}>{zone.kind}</Badge>
                          <span>#{zone.serial}</span>
                        </div>
                      </div>
                    </div>
                    {zone.dnssec && <Shield className="h-4 w-4 text-green-600" />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {computedStats && (
          <ZoneTypeChart native={computedStats.nativeZones} master={computedStats.masterZones} slave={computedStats.slaveZones} />
        )}
      </div>

      {/* Row 4: Activity chart + Recent activity list */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityChart logs={logs} />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Latest actions performed</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/activity">View all<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">No recent activity</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <Activity className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{log.action}</p>
                        <p className="text-xs text-muted-foreground">{log.resource} &bull; {log.user}</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(log.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 5: API Proxy KPIs */}
      {proxyStats && (
        <>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">API Proxy</h2>
            <p className="text-sm text-muted-foreground">Proxy requests overview (last 7 days)</p>
          </div>

          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Requests Today"
              value={proxyStats.requests.today.toLocaleString()}
              description={`${proxyStats.requests.week.toLocaleString()} this week`}
              icon={Radio}
            />
            <StatCard
              title="Total Requests"
              value={proxyStats.requests.month.toLocaleString()}
              description="Last 30 days"
              icon={Wifi}
            />
            <StatCard
              title="Errors Today"
              value={proxyStats.errors.today.toLocaleString()}
              description={`${proxyStats.errors.week.toLocaleString()} this week`}
              icon={AlertTriangle}
              className={proxyStats.errors.today > 0 ? 'border-red-200 dark:border-red-900' : ''}
            />
            <StatCard
              title="Success Rate"
              value={proxyStats.requests.week > 0
                ? `${((proxyStats.statusBreakdown.success / proxyStats.requests.week) * 100).toFixed(1)}%`
                : '—'}
              description="Last 7 days"
              icon={Shield}
            />
          </div>

          {/* Chart + Tables */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Daily requests chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Daily Requests</CardTitle>
                <CardDescription>Requests and errors per day</CardDescription>
              </CardHeader>
              <CardContent>
                {proxyStats.daily.length > 0 ? (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={proxyStats.daily} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} className="text-muted-foreground" />
                        <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="requests" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Requests" />
                        <Bar dataKey="errors" fill="#ef4444" radius={[3, 3, 0, 0]} name="Errors" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
                )}
              </CardContent>
            </Card>

            {/* Top IPs */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Source IPs</CardTitle>
                <CardDescription>Most active clients (7 days)</CardDescription>
              </CardHeader>
              <CardContent>
                {proxyStats.topIps.length > 0 ? (
                  <Table className="[&_td]:py-1 [&_th]:py-1">
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP Address</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {proxyStats.topIps.map((item) => (
                        <TableRow key={item.ip}>
                          <TableCell className="font-mono text-xs">{item.ip}</TableCell>
                          <TableCell className="text-right">{item.count.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top zones + Top API accesses */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Zones</CardTitle>
                <CardDescription>Most requested zones (7 days)</CardDescription>
              </CardHeader>
              <CardContent>
                {proxyStats.topZones.length > 0 ? (
                  <Table className="[&_td]:py-1 [&_th]:py-1">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zone</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {proxyStats.topZones.map((item) => (
                        <TableRow key={item.zone}>
                          <TableCell className="font-mono text-xs">{item.zone}</TableCell>
                          <TableCell className="text-right">{item.count.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top API Accesses</CardTitle>
                <CardDescription>Most active tokens (7 days)</CardDescription>
              </CardHeader>
              <CardContent>
                {proxyStats.topAccesses.length > 0 ? (
                  <Table className="[&_td]:py-1 [&_th]:py-1">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {proxyStats.topAccesses.map((item) => (
                        <TableRow key={item.name}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell className="text-right">{item.count.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
