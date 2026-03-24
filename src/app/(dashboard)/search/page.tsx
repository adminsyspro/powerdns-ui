'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, Globe, FileText, MessageSquare, AlertCircle, Server } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getRecordTypeColor } from '@/lib/utils';
import { useServerConnectionStore } from '@/stores';
import * as api from '@/lib/api';
import type { SearchResult } from '@/types/powerdns';

export default function SearchPage() {
  return (
    <React.Suspense fallback={<div className="flex items-center justify-center py-12"><Search className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <SearchPageContent />
    </React.Suspense>
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const { activeConnection } = useServerConnectionStore();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = React.useState(initialQuery);
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (initialQuery && activeConnection) {
      performSearch(initialQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, activeConnection?.id]);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim() || !activeConnection) return;
    setIsSearching(true);
    setSearchError(null);
    const result = await api.searchPdns(searchQuery);
    if (result.error) {
      setSearchError(result.error);
      setResults([]);
    } else {
      setResults(result.data || []);
    }
    setIsSearching(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
    window.history.pushState({}, '', `/search?q=${encodeURIComponent(query)}`);
  };

  const zones = results.filter((r) => r.object_type === 'zone');
  const records = results.filter((r) => r.object_type === 'record');
  const comments = results.filter((r) => r.object_type === 'comment');

  if (!activeConnection) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold tracking-tight">Search</h1></div>
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Search</h1>
        <p className="text-muted-foreground">Search across all zones and records</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search zones, records, IP addresses..."
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={isSearching}>
          {isSearching ? 'Searching...' : 'Search'}
        </Button>
      </form>

      {searchError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">All ({results.length})</TabsTrigger>
            <TabsTrigger value="zones">Zones ({zones.length})</TabsTrigger>
            <TabsTrigger value="records">Records ({records.length})</TabsTrigger>
            <TabsTrigger value="comments">Comments ({comments.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-2">
            {results.map((result, idx) => (<SearchResultCard key={idx} result={result} />))}
          </TabsContent>

          <TabsContent value="zones" className="space-y-2">
            {zones.map((result, idx) => (<SearchResultCard key={idx} result={result} />))}
          </TabsContent>

          <TabsContent value="records" className="space-y-2">
            {records.map((result, idx) => (<SearchResultCard key={idx} result={result} />))}
          </TabsContent>

          <TabsContent value="comments" className="space-y-2">
            {comments.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No comments found</p>
            ) : (
              comments.map((result, idx) => (<SearchResultCard key={idx} result={result} />))
            )}
          </TabsContent>
        </Tabs>
      )}

      {query && results.length === 0 && !isSearching && !searchError && (
        <div className="text-center py-12">
          <Search className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No results found</h3>
          <p className="text-muted-foreground">Try adjusting your search terms</p>
        </div>
      )}
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const Icon = result.object_type === 'zone' ? Globe : result.object_type === 'record' ? FileText : MessageSquare;

  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/zones/${encodeURIComponent(result.zone_id)}`} className="font-medium hover:underline truncate">
              {result.name}
            </Link>
            {result.type && (
              <Badge className={getRecordTypeColor(result.type)} variant="outline">{result.type}</Badge>
            )}
            <Badge variant="secondary">{result.object_type}</Badge>
          </div>
          {result.content && (
            <p className="text-sm text-muted-foreground font-mono truncate">{result.content}</p>
          )}
          <p className="text-xs text-muted-foreground">Zone: {result.zone}</p>
        </div>
      </CardContent>
    </Card>
  );
}
