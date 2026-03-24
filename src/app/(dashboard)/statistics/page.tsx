'use client';

import * as React from 'react';
import { RefreshCw, Activity, Clock, Zap, HardDrive, AlertCircle, Server } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { StatCard, ServerMetricsChart } from '@/components/dashboard/stats';
import { useStatistics, statsToMap } from '@/hooks/use-pdns';
import { useServerConnectionStore } from '@/stores';

export default function StatisticsPage() {
  const { activeConnection } = useServerConnectionStore();
  const { data: rawStats, error, isLoading, refetch } = useStatistics();
  const stats = statsToMap(rawStats);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const formatBytes = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let val = bytes;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${units[i]}`;
  };

  const safeInt = (v: string | undefined) => parseInt(v || '0') || 0;

  const packetHits = safeInt(stats['packetcache-hit']);
  const packetMisses = safeInt(stats['packetcache-miss']);
  const packetTotal = packetHits + packetMisses;
  const cacheHitRate = packetTotal > 0 ? ((packetHits / packetTotal) * 100).toFixed(1) : '0';

  const queryHits = safeInt(stats['query-cache-hit']);
  const queryMisses = safeInt(stats['query-cache-miss']);
  const queryTotal = queryHits + queryMisses;
  const queryCacheRate = queryTotal > 0 ? ((queryHits / queryTotal) * 100).toFixed(1) : '0';

  if (!activeConnection) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold tracking-tight">Statistics</h1></div>
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <CardContent className="flex items-center justify-between py-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <p className="font-medium text-amber-800 dark:text-amber-200">No PowerDNS server connected</p>
            </div>
            <Button asChild variant="outline"><Link href="/servers"><Server className="mr-2 h-4 w-4" />Add Server</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Statistics</h1>
          <p className="text-muted-foreground">Real-time server performance metrics</p>
        </div>
        <Button onClick={refetch} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch} className="ml-auto">Retry</Button>
          </CardContent>
        </Card>
      )}

      {Object.keys(stats).length > 0 && (
        <>
          {/* Key Metrics */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Uptime" value={formatUptime(safeInt(stats['uptime']))} icon={Clock} description="Server running time" />
            <StatCard title="Total Queries" value={safeInt(stats['udp-queries'] || stats['queries']).toLocaleString()} icon={Activity} />
            <StatCard title="Cache Hit Rate" value={`${cacheHitRate}%`} icon={Zap} description="Packet cache efficiency" />
            <StatCard title="Memory Usage" value={formatBytes(safeInt(stats['real-memory-usage']))} icon={HardDrive} />
          </div>

          <ServerMetricsChart serverStats={stats} />

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Query Statistics */}
            <Card>
              <CardHeader><CardTitle className="text-base">Query Statistics</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow><TableCell>UDP Queries</TableCell><TableCell className="text-right font-mono">{safeInt(stats['udp-queries']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>TCP Queries</TableCell><TableCell className="text-right font-mono">{safeInt(stats['tcp-queries']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>UDP Answers</TableCell><TableCell className="text-right font-mono">{safeInt(stats['udp-answers']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>TCP Answers</TableCell><TableCell className="text-right font-mono">{safeInt(stats['tcp-answers']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>Backend Queries</TableCell><TableCell className="text-right font-mono">{safeInt(stats['backend-queries']).toLocaleString()}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Cache Statistics */}
            <Card>
              <CardHeader><CardTitle className="text-base">Cache Statistics</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1"><span>Packet Cache</span><span>{cacheHitRate}% hit rate</span></div>
                  <Progress value={parseFloat(cacheHitRate)} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Hits: {packetHits.toLocaleString()}</span>
                    <span>Misses: {packetMisses.toLocaleString()}</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1"><span>Query Cache</span><span>{queryCacheRate}% hit rate</span></div>
                  <Progress value={parseFloat(queryCacheRate)} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Hits: {queryHits.toLocaleString()}</span>
                    <span>Misses: {queryMisses.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Error Statistics */}
            <Card>
              <CardHeader><CardTitle className="text-base">Error Statistics</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow><TableCell>SERVFAIL Packets</TableCell><TableCell className="text-right font-mono text-red-600">{safeInt(stats['servfail-packets']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>Timed Out</TableCell><TableCell className="text-right font-mono text-amber-600">{safeInt(stats['timedout-packets']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>Corrupt Packets</TableCell><TableCell className="text-right font-mono text-red-600">{safeInt(stats['corrupt-packets']).toLocaleString()}</TableCell></TableRow>
                    <TableRow><TableCell>Query Queue Size</TableCell><TableCell className="text-right font-mono">{stats['qsize-q'] || '0'}</TableCell></TableRow>
                    <TableRow><TableCell>Average Latency</TableCell><TableCell className="text-right font-mono">{stats['latency'] || '0'}ms</TableCell></TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* System Resources */}
            <Card>
              <CardHeader><CardTitle className="text-base">System Resources</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow><TableCell>Memory Usage</TableCell><TableCell className="text-right font-mono">{formatBytes(safeInt(stats['real-memory-usage']))}</TableCell></TableRow>
                    <TableRow><TableCell>File Descriptors</TableCell><TableCell className="text-right font-mono">{stats['fd-usage'] || '0'}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
