'use client';

import * as React from 'react';
import {
  Plus, Edit2, Trash2, Loader2, RefreshCw, Copy, Check, X,
  Shield, Upload, Eye, EyeOff, KeyRound, ChevronDown, ChevronRight,
  ChevronLeft, ChevronsLeft, ChevronsRight, Search, Radio, CircleSlash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';
import { useServerConnectionStore } from '@/stores';

interface RecordRule {
  id: string;
  ruleType: 'exact' | 'regex';
  pattern: string;
}

interface ZonePermission {
  id: string;
  environmentId: string;
  zoneName: string;
  acmeEnabled: boolean;
  recordRules: RecordRule[];
}

interface ProxyEnvironment {
  id: string;
  name: string;
  description: string;
  tokenSha512: string;
  active: boolean;
  zoneCount: number;
  zones?: ZonePermission[];
  createdAt: string;
  updatedAt: string;
}

export default function ProxyPage() {
  const [environments, setEnvironments] = React.useState<ProxyEnvironment[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  // Search & Pagination
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  // Environment dialog
  const [envDialogOpen, setEnvDialogOpen] = React.useState(false);
  const [editingEnv, setEditingEnv] = React.useState<ProxyEnvironment | null>(null);
  interface EnvFormZone {
    zoneName: string;
    acmeEnabled: boolean;
    allowedRecords: string[];
  }
  const emptyZone = (): EnvFormZone => ({ zoneName: '', acmeEnabled: false, allowedRecords: [] });
  const [envForm, setEnvForm] = React.useState<{ name: string; description: string; zones: EnvFormZone[] }>({ name: '', description: '', zones: [] });
  const [envError, setEnvError] = React.useState('');

  // Token display dialog
  const [tokenDialogOpen, setTokenDialogOpen] = React.useState(false);
  const [displayedToken, setDisplayedToken] = React.useState('');
  const [tokenCopied, setTokenCopied] = React.useState(false);

  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);
  const [importYaml, setImportYaml] = React.useState('');
  const [importError, setImportError] = React.useState('');
  const [importResult, setImportResult] = React.useState<{ environments: number; zones: number; recordRules: number; skipped: string[] } | null>(null);

  // Zone management
  const [expandedEnvId, setExpandedEnvId] = React.useState<string | null>(null);
  const [envDetails, setEnvDetails] = React.useState<Record<string, ProxyEnvironment>>({});
  const [zoneDialogOpen, setZoneDialogOpen] = React.useState(false);
  const [zoneEnvId, setZoneEnvId] = React.useState('');
  const [editingZone, setEditingZone] = React.useState<ZonePermission | null>(null);
  const [zoneForm, setZoneForm] = React.useState({ zoneName: '', acmeEnabled: false, records: [''], regexRecords: [''] });
  const [zoneError, setZoneError] = React.useState('');

  // Available zones from PowerDNS
  const [availableZones, setAvailableZones] = React.useState<string[]>([]);
  const [zonePickerOpen, setZonePickerOpen] = React.useState(false);
  const [zonePickerSearch, setZonePickerSearch] = React.useState('');

  const fetchEnvironments = async () => {
    const res = await fetch('/api/proxy/environments');
    if (res.ok) {
      setEnvironments(await res.json());
    }
    setIsLoading(false);
  };

  React.useEffect(() => {
    fetchEnvironments();
    fetchAvailableZones();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEnvDetails = async (envId: string) => {
    const res = await fetch(`/api/proxy/environments/${envId}`);
    if (res.ok) {
      const data = await res.json();
      setEnvDetails((prev) => ({ ...prev, [envId]: data }));
    }
  };

  const { activeConnection } = useServerConnectionStore();

  const fetchAvailableZones = async () => {
    try {
      const headers: Record<string, string> = {};
      if (activeConnection) {
        headers['x-pdns-url'] = activeConnection.url;
        headers['x-pdns-api-key'] = activeConnection.apiKey;
      }
      const res = await fetch('/api/zones/cached?pageSize=200', { headers });
      if (res.ok) {
        const data = await res.json();
        const items = (data.items || []) as Array<{ name: string }>;
        setAvailableZones(items.map((z) => z.name).sort());
      }
    } catch {
      // Ignore
    }
  };

  // --- Environment CRUD ---

  const handleEnvSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvError('');

    const url = editingEnv
      ? `/api/proxy/environments/${editingEnv.id}`
      : '/api/proxy/environments';
    const method = editingEnv ? 'PUT' : 'POST';

    const payload: Record<string, unknown> = { name: envForm.name, description: envForm.description };

    // Include zones — auto-detect regex patterns (contain * or other regex chars)
    if (envForm.zones.length > 0 || editingEnv) {
      payload.zones = envForm.zones
        .filter((z) => z.zoneName.trim())
        .map((z) => {
          const records: string[] = [];
          const regexRecords: string[] = [];
          for (const r of z.allowedRecords) {
            const full = r.trim() ? `${r.trim()}.${z.zoneName}` : '';
            if (!full) continue;
            if (/[*+?{}()\[\]\\|^$]/.test(r)) {
              regexRecords.push(full);
            } else {
              records.push(full);
            }
          }
          return {
            zoneName: z.zoneName,
            acmeEnabled: z.acmeEnabled,
            records,
            regexRecords,
          };
        });
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      setEnvError(data.error || 'An error occurred');
      return;
    }

    const data = await res.json();

    // Show token dialog for new environments
    if (!editingEnv && data.token) {
      setDisplayedToken(data.token);
      setTokenDialogOpen(true);
    }

    const editedId = editingEnv?.id;
    setEnvDialogOpen(false);
    setEditingEnv(null);
    setEnvForm({ name: '', description: '', zones: [] });
    fetchEnvironments();
    if (editedId) fetchEnvDetails(editedId);
  };

  const handleEditEnv = async (env: ProxyEnvironment) => {
    setEditingEnv(env);
    setEnvError('');
    fetchAvailableZones();

    // Load existing zones into the form
    const res = await fetch(`/api/proxy/environments/${env.id}`);
    if (res.ok) {
      const data = await res.json();
      const zones = (data.zones || []).map((z: ZonePermission) => {
        // Extract prefix from full record patterns (remove .zoneName suffix)
        const suffix = `.${z.zoneName.replace(/\.$/, '')}`;
        return {
          zoneName: z.zoneName,
          acmeEnabled: z.acmeEnabled,
          allowedRecords: z.recordRules.map((r) => {
            const pattern = r.pattern;
            // Strip the zone suffix to show just the prefix
            if (pattern.endsWith(suffix)) {
              return pattern.slice(0, -suffix.length);
            }
            return pattern;
          }),
        };
      });
      setEnvForm({ name: env.name, description: env.description || '', zones });
    } else {
      setEnvForm({ name: env.name, description: env.description || '', zones: [] });
    }

    setEnvDialogOpen(true);
  };

  const handleDeleteEnv = async (env: ProxyEnvironment) => {
    const res = await fetch(`/api/proxy/environments/${env.id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchEnvironments();
      if (expandedEnvId === env.id) setExpandedEnvId(null);
    }
  };

  const handleRegenerateToken = async (envId: string) => {
    const res = await fetch(`/api/proxy/environments/${envId}/regenerate-token`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setDisplayedToken(data.token);
      setTokenDialogOpen(true);
      fetchEnvironments();
    }
  };

  const handleToggleActive = async (env: ProxyEnvironment) => {
    await fetch(`/api/proxy/environments/${env.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !env.active }),
    });
    fetchEnvironments();
  };

  // --- Token copy ---

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(displayedToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  // --- Import ---

  const handleImport = async () => {
    setImportError('');
    setImportResult(null);

    if (!importYaml) {
      setImportError('YAML config content is required');
      return;
    }

    const res = await fetch('/api/proxy/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configYaml: importYaml }),
    });

    const data = await res.json();

    if (!res.ok) {
      setImportError(data.error || 'Import failed');
      return;
    }

    setImportResult(data.summary);
    fetchEnvironments();
  };

  // --- Zone permissions ---

  const handleToggleExpand = (envId: string) => {
    if (expandedEnvId === envId) {
      setExpandedEnvId(null);
    } else {
      setExpandedEnvId(envId);
      if (!envDetails[envId]) {
        fetchEnvDetails(envId);
      }
    }
  };

  const openAddZone = (envId: string) => {
    fetchAvailableZones();
    setZoneEnvId(envId);
    setEditingZone(null);
    setZoneForm({ zoneName: '', acmeEnabled: false, records: [''], regexRecords: [''] });
    setZoneError('');
    setZoneDialogOpen(true);
  };

  const openEditZone = (envId: string, zone: ZonePermission) => {
    fetchAvailableZones();
    setZoneEnvId(envId);
    setEditingZone(zone);
    setZoneForm({
      zoneName: zone.zoneName,
      acmeEnabled: zone.acmeEnabled,
      records: zone.recordRules.filter((r) => r.ruleType === 'exact').map((r) => r.pattern).concat(['']),
      regexRecords: zone.recordRules.filter((r) => r.ruleType === 'regex').map((r) => r.pattern).concat(['']),
    });
    setZoneError('');
    setZoneDialogOpen(true);
  };

  const handleZoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setZoneError('');

    const records = zoneForm.records.filter((r) => r.trim());
    const regexRecords = zoneForm.regexRecords.filter((r) => r.trim());

    const url = editingZone
      ? `/api/proxy/environments/${zoneEnvId}/zones/${editingZone.id}`
      : `/api/proxy/environments/${zoneEnvId}/zones`;
    const method = editingZone ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneName: zoneForm.zoneName,
        acmeEnabled: zoneForm.acmeEnabled,
        records: records.length > 0 ? records : undefined,
        regexRecords: regexRecords.length > 0 ? regexRecords : undefined,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setZoneError(data.error || 'An error occurred');
      return;
    }

    setZoneDialogOpen(false);
    fetchEnvDetails(zoneEnvId);
    fetchEnvironments();
  };

  const handleDeleteZone = async (envId: string, zonePermId: string) => {
    const res = await fetch(`/api/proxy/environments/${envId}/zones/${zonePermId}`, { method: 'DELETE' });
    if (res.ok) {
      fetchEnvDetails(envId);
      fetchEnvironments();
    }
  };

  // --- List helpers ---

  const updateListItem = (
    list: string[],
    index: number,
    value: string,
    setter: (list: string[]) => void
  ) => {
    const newList = [...list];
    newList[index] = value;
    setter(newList);
  };

  const addListItem = (list: string[], setter: (list: string[]) => void) => {
    setter([...list, '']);
  };

  const removeListItem = (list: string[], index: number, setter: (list: string[]) => void) => {
    setter(list.filter((_, i) => i !== index));
  };

  // --- Search & Pagination ---

  const filteredEnvs = React.useMemo(() => {
    if (!search.trim()) return environments;
    const q = search.toLowerCase();
    return environments.filter((env) =>
      env.name.toLowerCase().includes(q) ||
      (env.description || '').toLowerCase().includes(q)
    );
  }, [environments, search]);

  const totalPages = Math.max(1, Math.ceil(filteredEnvs.length / pageSize));
  const paginatedEnvs = filteredEnvs.slice((page - 1) * pageSize, page * pageSize);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  // Reset page if it exceeds total after deletion/filter
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // --- Logs ---

  interface LogEntry {
    id: number;
    timestamp: string;
    environmentId: string | null;
    environmentName: string | null;
    method: string;
    path: string;
    zone: string | null;
    status: number;
    ip: string;
    userAgent: string;
    durationMs: number;
    error: string | null;
  }

  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [logsTotal, setLogsTotal] = React.useState(0);
  const [logsPage, setLogsPage] = React.useState(1);
  const [logsPageSize, setLogsPageSize] = React.useState(50);
  const [logsTotalPages, setLogsTotalPages] = React.useState(1);
  const [liveMode, setLiveMode] = React.useState(false);
  const [logsLoading, setLogsLoading] = React.useState(false);
  const logsEndRef = React.useRef<HTMLDivElement>(null);
  const eventSourceRef = React.useRef<EventSource | null>(null);
  const MAX_LIVE_LOGS = 200;
  const [selectedLog, setSelectedLog] = React.useState<LogEntry | null>(null);

  const fetchLogs = async (pg = logsPage, ps = logsPageSize) => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/proxy/logs?page=${pg}&pageSize=${ps}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.items);
        setLogsTotal(data.total);
        setLogsTotalPages(data.totalPages);
        setLogsPage(data.page);
      }
    } catch {
      // Ignore
    }
    setLogsLoading(false);
  };

  const handleLogsPageChange = (pg: number) => {
    setLogsPage(pg);
    fetchLogs(pg, logsPageSize);
  };

  const handleLogsPageSizeChange = (ps: number) => {
    setLogsPageSize(ps);
    setLogsPage(1);
    fetchLogs(1, ps);
  };

  // Initial load
  React.useEffect(() => {
    fetchLogs(1, logsPageSize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE live mode
  React.useEffect(() => {
    if (!liveMode) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        // Reload paginated logs when exiting live mode
        fetchLogs(1, logsPageSize);
      }
      return;
    }

    const es = new EventSource('/api/proxy/logs/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LIVE_LOGS ? next.slice(-MAX_LIVE_LOGS) : next;
        });
      } catch {
        // Skip non-JSON messages (keepalives)
      }
    };

    es.onerror = () => {
      // Reconnect handled by browser
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [liveMode]);

  // Auto-scroll in live mode
  React.useEffect(() => {
    if (liveMode && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, liveMode]);

  const getStatusColor = (status: number) => {
    if (status < 300) return 'text-green-600 dark:text-green-400';
    if (status < 400) return 'text-yellow-600 dark:text-yellow-400';
    if (status < 500) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'text-blue-600 dark:text-blue-400',
      POST: 'text-green-600 dark:text-green-400',
      PATCH: 'text-amber-600 dark:text-amber-400',
      PUT: 'text-purple-600 dark:text-purple-400',
      DELETE: 'text-red-600 dark:text-red-400',
    };
    return colors[method] || 'text-muted-foreground';
  };

  const formatLogTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // --- Render ---

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API Proxy</h1>
        <p className="text-muted-foreground">
          Manage API accesses and granular access control
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        {environments.length > 0 ? (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search API accesses..."
              className="pl-9"
            />
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2 shrink-0">
          {/* Import button */}
          <Dialog open={importDialogOpen} onOpenChange={(open) => { setImportDialogOpen(open); if (!open) { setImportError(''); setImportResult(null); } }}>
            <DialogTrigger asChild>
              <Button variant="outline"><Upload className="mr-2 h-4 w-4" />Import</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import powerdns-api-proxy Config</DialogTitle>
                <DialogDescription>
                  Paste your existing config.yml content to import API accesses, zones, and record rules.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {importError && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{importError}</div>
                )}
                {importResult && (
                  <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3 text-sm text-green-800 dark:text-green-300">
                    <p className="font-medium">Import successful!</p>
                    <p>{importResult.environments} API accesses, {importResult.zones} zones, {importResult.recordRules} record rules imported.</p>
                    {importResult.skipped.length > 0 && (
                      <div className="mt-2">
                        <p className="font-medium">Skipped:</p>
                        <ul className="list-disc pl-4">
                          {importResult.skipped.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Config YAML</Label>
                  <Textarea
                    value={importYaml}
                    onChange={(e) => setImportYaml(e.target.value)}
                    placeholder="Paste your config.yml content here..."
                    className="min-h-[300px] font-mono text-sm"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleImport}>Import</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Add environment button */}
          <Dialog open={envDialogOpen} onOpenChange={(open) => { setEnvDialogOpen(open); if (!open) { setEditingEnv(null); setEnvError(''); } }}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEditingEnv(null); setEnvForm({ name: '', description: '', zones: [] }); fetchAvailableZones(); }}>
                <Plus className="mr-2 h-4 w-4" />Add API Access
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingEnv ? 'Edit API Access' : 'Add API Access'}</DialogTitle>
                <DialogDescription>
                  {editingEnv ? 'Update API access settings and zone permissions.' : 'Create a new API access with zones and access rules.'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleEnvSubmit} className="space-y-4">
                {envError && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{envError}</div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={envForm.name}
                      onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })}
                      placeholder="e.g., certbot-production"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={envForm.description}
                      onChange={(e) => setEnvForm({ ...envForm, description: e.target.value })}
                      placeholder="Optional description"
                    />
                  </div>
                </div>

                {/* Inline zones */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-semibold">Zones</Label>
                      <Popover open={zonePickerOpen} onOpenChange={(open) => { setZonePickerOpen(open); if (!open) setZonePickerSearch(''); }}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="w-[260px] justify-between font-normal">
                            <span className="text-muted-foreground">Select a zone to add...</span>
                            <ChevronDown className="ml-2 h-3 w-3 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0" align="end">
                          <div className="p-2 border-b">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                value={zonePickerSearch}
                                onChange={(e) => setZonePickerSearch(e.target.value)}
                                placeholder="Search zones..."
                                className="h-8 pl-8 text-sm"
                                autoFocus
                              />
                            </div>
                          </div>
                          <ScrollArea className="max-h-[250px]">
                            <div className="p-1">
                              {(() => {
                                const filtered = availableZones
                                  .filter((z) => !envForm.zones.some((ez) => ez.zoneName === z))
                                  .filter((z) => !zonePickerSearch || z.toLowerCase().includes(zonePickerSearch.toLowerCase()));
                                if (filtered.length === 0) {
                                  return <p className="px-3 py-4 text-sm text-center text-muted-foreground">No zones found</p>;
                                }
                                return filtered.map((z) => (
                                  <button
                                    key={z}
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                                    onClick={() => {
                                      setEnvForm({ ...envForm, zones: [...envForm.zones, { ...emptyZone(), zoneName: z }] });
                                      setZonePickerOpen(false);
                                      setZonePickerSearch('');
                                    }}
                                  >
                                    {z}
                                  </button>
                                ));
                              })()}
                            </div>
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {envForm.zones.length === 0 && (
                      <p className="text-sm text-muted-foreground py-2">No zones yet. Select a zone above to configure access.</p>
                    )}

                    {envForm.zones.map((zone, zi) => {
                      const updateZone = (partial: Partial<EnvFormZone>) => {
                        const newZones = [...envForm.zones];
                        newZones[zi] = { ...newZones[zi], ...partial };
                        setEnvForm({ ...envForm, zones: newZones });
                      };
                      const removeZone = () => {
                        setEnvForm({ ...envForm, zones: envForm.zones.filter((_, i) => i !== zi) });
                      };

                      return (
                        <div key={zi} className="rounded-lg border p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm font-medium">{zone.zoneName}</span>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={zone.acmeEnabled}
                                  onCheckedChange={(checked) => updateZone({ acmeEnabled: checked })}
                                />
                                <Label className="text-xs whitespace-nowrap">ACME</Label>
                              </div>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={removeZone}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Allowed records */}
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              Allowed records <span className="text-muted-foreground/60">(leave empty for full access)</span>
                            </Label>
                            {zone.allowedRecords.map((record, ri) => (
                              <div key={ri} className="flex items-center gap-1">
                                <div className="relative flex-1">
                                  <Input
                                    value={record}
                                    onChange={(e) => {
                                      const newRecords = [...zone.allowedRecords];
                                      newRecords[ri] = e.target.value;
                                      updateZone({ allowedRecords: newRecords });
                                    }}
                                    placeholder="e.g., ssl  or  _acme-challenge.*"
                                    className="h-8 text-sm pr-[var(--suffix-width)]"
                                    style={{ '--suffix-width': `${zone.zoneName.length * 7.2 + 24}px` } as React.CSSProperties}
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/40 pointer-events-none select-none">
                                    .{zone.zoneName}
                                  </span>
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => updateZone({ allowedRecords: zone.allowedRecords.filter((_, i) => i !== ri) })}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => updateZone({ allowedRecords: [...zone.allowedRecords, ''] })}>
                              <Plus className="mr-1 h-3 w-3" /> Add record rule
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                <DialogFooter>
                  <Button type="submit">{editingEnv ? 'Update' : 'Create'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Token display dialog */}
      <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> API Token
            </DialogTitle>
            <DialogDescription>
              This token will only be shown once. Store it securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all text-sm font-mono">{displayedToken}</code>
                <Button variant="ghost" size="icon" onClick={handleCopyToken}>
                  {tokenCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
              <strong>Warning:</strong> This token will not be shown again. Make sure to copy and store it in a secure location.
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setTokenDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone permission dialog */}
      <Dialog open={zoneDialogOpen} onOpenChange={(open) => { setZoneDialogOpen(open); if (!open) { setEditingZone(null); setZoneError(''); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingZone ? 'Edit Zone Permission' : 'Add Zone Permission'}</DialogTitle>
            <DialogDescription>
              Configure access to a DNS zone and optionally restrict which records can be modified.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleZoneSubmit} className="space-y-4">
            {zoneError && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{zoneError}</div>
            )}
            <div className="space-y-2">
              <Label>Zone Name</Label>
              {!editingZone ? (
                <div className="relative">
                  <Input
                    value={zoneForm.zoneName}
                    onChange={(e) => setZoneForm({ ...zoneForm, zoneName: e.target.value })}
                    placeholder="e.g., example.com"
                    required
                    list="zone-suggestions"
                  />
                  <datalist id="zone-suggestions">
                    {availableZones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <Input value={zoneForm.zoneName} disabled />
              )}
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={zoneForm.acmeEnabled}
                onCheckedChange={(checked) => setZoneForm({ ...zoneForm, acmeEnabled: checked })}
              />
              <Label>ACME (Let&apos;s Encrypt) — auto-allow _acme-challenge.* TXT records</Label>
            </div>

            {/* Exact records */}
            <div className="space-y-2">
              <Label>Allowed Records (exact names)</Label>
              <p className="text-xs text-muted-foreground">Leave empty for full zone access. Add specific record names to restrict write access.</p>
              {zoneForm.records.map((record, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={record}
                    onChange={(e) => updateListItem(zoneForm.records, i, e.target.value, (list) => setZoneForm({ ...zoneForm, records: list }))}
                    placeholder="e.g., ssl.example.com"
                  />
                  {zoneForm.records.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeListItem(zoneForm.records, i, (list) => setZoneForm({ ...zoneForm, records: list }))}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addListItem(zoneForm.records, (list) => setZoneForm({ ...zoneForm, records: list }))}>
                <Plus className="mr-1 h-3 w-3" /> Add Record
              </Button>
            </div>

            {/* Regex records */}
            <div className="space-y-2">
              <Label>Allowed Records (regex patterns)</Label>
              <p className="text-xs text-muted-foreground">Regex patterns to match allowed record names.</p>
              {zoneForm.regexRecords.map((pattern, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={pattern}
                    onChange={(e) => updateListItem(zoneForm.regexRecords, i, e.target.value, (list) => setZoneForm({ ...zoneForm, regexRecords: list }))}
                    placeholder="e.g., _acme-challenge.*.example.com"
                    className="font-mono text-sm"
                  />
                  {zoneForm.regexRecords.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeListItem(zoneForm.regexRecords, i, (list) => setZoneForm({ ...zoneForm, regexRecords: list }))}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => addListItem(zoneForm.regexRecords, (list) => setZoneForm({ ...zoneForm, regexRecords: list }))}>
                <Plus className="mr-1 h-3 w-3" /> Add Pattern
              </Button>
            </div>

            <DialogFooter>
              <Button type="submit">{editingZone ? 'Update' : 'Add'} Zone</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Environments table */}
      {environments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">No API accesses configured</p>
          <p className="text-sm">Create an API access or import an existing config.yml to get started.</p>
        </div>
      ) : (
        <>
        <div className="rounded-md border">
          <Table className="[&_td]:py-0.5 [&_th]:py-1">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Zones</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedEnvs.map((env) => (
                <React.Fragment key={env.id}>
                  <TableRow className="cursor-pointer" onClick={() => handleToggleExpand(env.id)}>
                    <TableCell>
                      {expandedEnvId === env.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{env.name}</TableCell>
                    <TableCell className="text-muted-foreground">{env.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{env.zoneCount}</Badge>
                    </TableCell>
                    <TableCell>
                      {env.active ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(env.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={() => handleToggleActive(env)}>
                                {env.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{env.active ? 'Disable' : 'Enable'}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={() => handleRegenerateToken(env.id)}>
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Regenerate Token</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={() => handleEditEnv(env)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <AlertDialog>
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete API access</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete <span className="font-semibold">{env.name}</span>? This will remove all zone permissions and invalidate the token.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleDeleteEnv(env)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded zone details */}
                  {expandedEnvId === env.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/30 p-0">
                        <div className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Zone Permissions</h3>
                            <Button size="sm" onClick={() => openAddZone(env.id)}>
                              <Plus className="mr-1 h-3 w-3" /> Add Zone
                            </Button>
                          </div>
                          {envDetails[env.id]?.zones && envDetails[env.id].zones!.length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Zone</TableHead>
                                  <TableHead>ACME</TableHead>
                                  <TableHead>Record Rules</TableHead>
                                  <TableHead className="w-[80px]"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {envDetails[env.id].zones!.map((zone) => (
                                  <TableRow key={zone.id}>
                                    <TableCell className="font-mono text-sm">{zone.zoneName}</TableCell>
                                    <TableCell>
                                      {zone.acmeEnabled ? (
                                        <Badge variant="default" className="text-xs">Enabled</Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-xs">Disabled</Badge>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {zone.recordRules.length === 0 && !zone.acmeEnabled ? (
                                        <span className="text-xs text-muted-foreground">All records (full access)</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1">
                                          {zone.recordRules.map((rule) => (
                                            <Badge key={rule.id} variant="outline" className="text-xs font-mono">
                                              {rule.ruleType === 'regex' ? '/' : ''}{rule.pattern}{rule.ruleType === 'regex' ? '/' : ''}
                                            </Badge>
                                          ))}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditZone(env.id, zone)}>
                                          <Edit2 className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive hover:text-destructive"
                                          onClick={() => handleDeleteZone(env.id, zone.id)}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <p className="text-sm text-muted-foreground py-2">No zone permissions configured. Add zones to grant API access.</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {filteredEnvs.length > pageSize && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Showing {((page - 1) * pageSize + 1)}-{Math.min(page * pageSize, filteredEnvs.length)} of {filteredEnvs.length} API accesses
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => handlePageSizeChange(parseInt(value))}
              >
                <SelectTrigger className="w-[80px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
              <span>per page</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={page <= 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      {/* Logs Section */}
      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Proxy Logs</h2>
            <p className="text-sm text-muted-foreground">Real-time proxy request logs</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={liveMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLiveMode(!liveMode)}
            >
              {liveMode ? (
                <>
                  <Radio className="mr-2 h-3 w-3 animate-pulse" />
                  Live
                </>
              ) : (
                <>
                  <Radio className="mr-2 h-3 w-3" />
                  Start Live
                </>
              )}
            </Button>
            {!liveMode && (
              <Button variant="outline" size="sm" onClick={() => fetchLogs()}>
                <RefreshCw className="mr-2 h-3 w-3" />
                Refresh
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto font-mono text-xs">
            {logsLoading && logs.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <CircleSlash className="h-8 w-8 mb-2 opacity-50" />
                <p>No proxy logs yet</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2 w-[80px]">Time</th>
                    <th className="px-3 py-2 w-[60px]">Method</th>
                    <th className="px-3 py-2 w-[50px]">Status</th>
                    <th className="px-3 py-2">API Access</th>
                    <th className="px-3 py-2">Path</th>
                    <th className="px-3 py-2">Zone</th>
                    <th className="px-3 py-2 w-[60px]">Duration</th>
                    <th className="px-3 py-2">IP</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className={`border-t border-border/50 hover:bg-muted/40 cursor-pointer ${log.status >= 400 ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatLogTime(log.timestamp)}</td>
                      <td className={`px-3 py-1.5 font-semibold ${getMethodColor(log.method)}`}>{log.method}</td>
                      <td className={`px-3 py-1.5 font-semibold ${getStatusColor(log.status)}`}>{log.status}</td>
                      <td className="px-3 py-1.5">{log.environmentName || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground max-w-[300px] truncate">{log.path}</td>
                      <td className="px-3 py-1.5">{log.zone || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{log.durationMs}ms</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{log.ip || '—'}</td>
                      <td className="px-3 py-1.5 text-red-600 dark:text-red-400 max-w-[200px] truncate">{log.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Logs pagination — hidden in live mode */}
        {!liveMode && logsTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Showing {((logsPage - 1) * logsPageSize + 1)}-{Math.min(logsPage * logsPageSize, logsTotal)} of {logsTotal} logs
              </span>
              <Select
                value={String(logsPageSize)}
                onValueChange={(v) => handleLogsPageSizeChange(parseInt(v))}
              >
                <SelectTrigger className="w-[80px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span>per page</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleLogsPageChange(1)} disabled={logsPage <= 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleLogsPageChange(logsPage - 1)} disabled={logsPage <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm">
                Page {logsPage} of {logsTotalPages}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleLogsPageChange(logsPage + 1)} disabled={logsPage >= logsTotalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleLogsPageChange(logsTotalPages)} disabled={logsPage >= logsTotalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Log detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Detail</DialogTitle>
            <DialogDescription>
              {selectedLog && new Date(selectedLog.timestamp).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-y-2">
                <span className="text-muted-foreground font-medium">Method</span>
                <span className={`font-semibold ${getMethodColor(selectedLog.method)}`}>{selectedLog.method}</span>

                <span className="text-muted-foreground font-medium">Status</span>
                <span className={`font-semibold ${getStatusColor(selectedLog.status)}`}>{selectedLog.status}</span>

                <span className="text-muted-foreground font-medium">Path</span>
                <span className="font-mono text-xs break-all">{selectedLog.path}</span>

                <span className="text-muted-foreground font-medium">API Access</span>
                <span>{selectedLog.environmentName || '—'}</span>

                <span className="text-muted-foreground font-medium">Zone</span>
                <span className="font-mono">{selectedLog.zone || '—'}</span>

                <span className="text-muted-foreground font-medium">Duration</span>
                <span>{selectedLog.durationMs}ms</span>

                <span className="text-muted-foreground font-medium">IP Address</span>
                <span className="font-mono">{selectedLog.ip || '—'}</span>

                <span className="text-muted-foreground font-medium">User Agent</span>
                <span className="text-xs break-all">{selectedLog.userAgent || '—'}</span>

                <span className="text-muted-foreground font-medium">Timestamp</span>
                <span className="font-mono text-xs">{selectedLog.timestamp}</span>
              </div>

              {selectedLog.error && (
                <div className="rounded-lg bg-destructive/10 p-3">
                  <span className="text-xs font-medium text-destructive">Error</span>
                  <p className="text-sm text-destructive mt-1">{selectedLog.error}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
