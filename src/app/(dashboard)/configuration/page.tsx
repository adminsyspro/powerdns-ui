'use client';

import * as React from 'react';
import Link from 'next/link';
import { RefreshCw, Search, AlertCircle, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfig } from '@/hooks/use-pdns';
import { useServerConnectionStore } from '@/stores';

export default function ConfigurationPage() {
  const { activeConnection } = useServerConnectionStore();
  const { data: config, error, isLoading, refetch } = useConfig();
  const [searchTerm, setSearchTerm] = React.useState('');

  const filteredConfig = React.useMemo(() => {
    if (!config) return [];
    return config.filter(
      (c) =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.value.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [config, searchTerm]);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'Bool': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'Integer': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'String': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!activeConnection) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold tracking-tight">Configuration</h1></div>
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
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
            <p className="text-muted-foreground">View PowerDNS server configuration (read-only)</p>
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

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Server Configuration</CardTitle>
                <CardDescription>{filteredConfig.length} settings</CardDescription>
              </div>
              <div className="relative w-[250px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search settings..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setting</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConfig.map((item) => (
                  <TableRow key={item.name}>
                    <TableCell className="font-mono text-sm font-medium">{item.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.value === 'yes' || item.value === 'true' ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">yes</Badge>
                      ) : item.value === 'no' || item.value === 'false' ? (
                        <Badge variant="secondary">no</Badge>
                      ) : item.name.includes('key') || item.name.includes('password') || item.name.includes('secret') ? (
                        '********'
                      ) : (
                        <Tooltip>
                          <TooltipTrigger className="truncate block max-w-[400px]">{item.value}</TooltipTrigger>
                          <TooltipContent><p className="max-w-[400px] break-all">{item.value}</p></TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell><Badge className={getTypeColor(item.type)} variant="outline">{item.type}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
