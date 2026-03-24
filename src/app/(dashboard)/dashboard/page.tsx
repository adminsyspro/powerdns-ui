'use client';

import * as React from 'react';
import Link from 'next/link';
import { Globe, ArrowRight, Shield, Activity, Server, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DashboardStats,
  ZoneTypeChart,
  ServerMetricsChart,
  CachePerformanceChart,
  ActivityChart,
} from '@/components/dashboard/stats';
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
    </div>
  );
}
