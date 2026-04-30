// src/components/zones/import-zone-dialog.tsx
'use client';

import * as React from 'react';
import { Upload, FileText, Loader2, ArrowLeft } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ImportPreviewTable } from './import-preview-table';
import * as api from '@/lib/api';
import type { ImportPreview } from '@/lib/bind/types';
import type { RRSet } from '@/types/powerdns';
import { usePendingChangesStore } from '@/stores';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export type ImportMode =
  | { type: 'create' }
  | { type: 'merge'; zoneId: string; zoneName: string };

interface ImportZoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ImportMode;
  onCreateSuccess?: (newZoneId: string) => void;
  onMergeStaged?: () => void;
}

type Step = 'source' | 'preview' | 'submitting';

export function ImportZoneDialog({
  open, onOpenChange, mode, onCreateSuccess, onMergeStaged,
}: ImportZoneDialogProps) {
  const [step, setStep] = React.useState<Step>('source');
  const [content, setContent] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [isParsing, setIsParsing] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const [zoneName, setZoneName] = React.useState('');
  const [kind, setKind] = React.useState<'Native' | 'Master' | 'Slave'>('Native');
  const [nameservers, setNameservers] = React.useState<string[]>([]);
  const [nameserverInput, setNameserverInput] = React.useState('');
  const [account, setAccount] = React.useState('');
  const [dnssec, setDnssec] = React.useState(false);
  const [soaEditApi, setSoaEditApi] = React.useState('DEFAULT');

  const [mergeStrategy, setMergeStrategy] = React.useState<'merge' | 'replace'>('merge');
  const [skipSoa, setSkipSoa] = React.useState(true);
  const [skipApexNs, setSkipApexNs] = React.useState(true);

  const addChange = usePendingChangesStore((s) => s.addChange);

  React.useEffect(() => {
    if (!open) {
      setStep('source');
      setContent('');
      setFileName(null);
      setParseError(null);
      setPreview(null);
      setSubmitError(null);
      setZoneName('');
      setKind('Native');
      setNameservers([]);
      setNameserverInput('');
      setAccount('');
      setDnssec(false);
      setSoaEditApi('DEFAULT');
      setMergeStrategy('merge');
      setSkipSoa(true);
      setSkipApexNs(true);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setParseError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 5 MB).`);
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setContent(text);
    setParseError(null);
  };

  const handlePreview = async () => {
    if (!content.trim()) {
      setParseError('Paste a BIND zone or upload a file first.');
      return;
    }
    setIsParsing(true);
    setParseError(null);
    const origin = mode.type === 'merge' ? mode.zoneName : undefined;
    const result = await api.parseBindZone(content, origin);
    setIsParsing(false);
    if (result.error) {
      setParseError(result.error);
      return;
    }
    if (!result.data) {
      setParseError('Empty response from parser.');
      return;
    }
    setPreview(result.data);

    if (mode.type === 'create') {
      const detected = result.data.detectedOrigin?.replace(/\.$/, '') || '';
      setZoneName(detected);
      const detectedOrigin = result.data.detectedOrigin;
      if (detectedOrigin) {
        const apexNs = result.data.rrsets
          .filter((rs) => rs.type === 'NS' && rs.name === detectedOrigin)
          .flatMap((rs) => rs.records.map((r) => r.content));
        if (apexNs.length > 0) setNameservers(apexNs);
      }
    }

    setStep('preview');
  };

  const addNameserver = () => {
    const v = nameserverInput.trim();
    if (!v) return;
    const ns = v.endsWith('.') ? v : `${v}.`;
    if (!nameservers.includes(ns)) setNameservers([...nameservers, ns]);
    setNameserverInput('');
  };

  const removeNameserver = (ns: string) => {
    setNameservers(nameservers.filter((n) => n !== ns));
  };

  const handleConfirmCreate = async () => {
    if (!preview) return;
    if (!zoneName.trim()) {
      setSubmitError('Zone name is required.');
      return;
    }
    if (nameservers.length === 0) {
      setSubmitError('At least one nameserver is required.');
      return;
    }
    setStep('submitting');
    setSubmitError(null);
    const result = await api.createZoneFromBind({
      content,
      name: zoneName,
      kind,
      nameservers,
      account: account || undefined,
      dnssec,
      soa_edit_api: soaEditApi,
    });
    if (result.error) {
      const canonicalName = zoneName.endsWith('.') ? zoneName : `${zoneName}.`;
      if (result.status === 409) {
        setSubmitError(`Zone "${canonicalName.replace(/\.$/, '')}" already exists.`);
      } else {
        setSubmitError(result.error);
      }
      setStep('preview');
      return;
    }
    const newId = result.data?.id || (zoneName.endsWith('.') ? zoneName : `${zoneName}.`);
    onCreateSuccess?.(newId);
    onOpenChange(false);
  };

  const handleConfirmMerge = async () => {
    if (!preview || mode.type !== 'merge') return;
    setStep('submitting');
    setSubmitError(null);

    const allCurrent: RRSet[] = [];
    let page = 1;
    const pageSize = 500;
    while (true) {
      const res = await api.fetchZoneRecords(mode.zoneId, { page, pageSize });
      if (res.error || !res.data) {
        setSubmitError(res.error || 'Failed to fetch current records');
        setStep('preview');
        return;
      }
      allCurrent.push(...res.data.rrsets);
      if (page >= res.data.totalPages) break;
      page++;
    }

    const currentByKey = new Map<string, RRSet>();
    for (const rs of allCurrent) currentByKey.set(`${rs.name}::${rs.type}`, rs);

    const apexName = mode.zoneName.endsWith('.') ? mode.zoneName : `${mode.zoneName}.`;
    const importFiltered = preview.rrsets.filter((rs) => {
      if (skipSoa && rs.type === 'SOA') return false;
      if (skipApexNs && rs.type === 'NS' && rs.name === apexName) return false;
      return true;
    });

    const importByKey = new Map<string, RRSet>();
    for (const rs of importFiltered) importByKey.set(`${rs.name}::${rs.type}`, rs);

    let staged = 0;

    for (const [key, rs] of importByKey) {
      const current = currentByKey.get(key);
      if (!current) {
        addChange(mode.zoneId, 'ADD', null, rs);
        staged++;
      } else if (!rrsetEqual(current, rs)) {
        addChange(mode.zoneId, 'EDIT', current, rs);
        staged++;
      }
    }

    if (mergeStrategy === 'replace') {
      for (const [key, current] of currentByKey) {
        if (importByKey.has(key)) continue;
        if (current.type === 'SOA') continue;
        if (skipApexNs && current.type === 'NS' && current.name === apexName) continue;
        addChange(mode.zoneId, 'DELETE', current, null);
        staged++;
      }
    }

    if (staged === 0) {
      setSubmitError('No changes to stage (zone already matches the imported file).');
      setStep('preview');
      return;
    }

    onMergeStaged?.();
    onOpenChange(false);
  };

  const handleConfirm = mode.type === 'create' ? handleConfirmCreate : handleConfirmMerge;
  const validRecordCount = preview?.rrsets.length || 0;
  const canConfirm = !!preview && validRecordCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {mode.type === 'create'
              ? 'Import zone (BIND format)'
              : `Import records into ${mode.zoneName.replace(/\.$/, '')}`}
          </DialogTitle>
          <DialogDescription>
            {mode.type === 'create'
              ? 'Paste a BIND zone file or upload one to create a new zone.'
              : 'Records will be staged in pending changes; you confirm and apply them via the validation modal.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {step === 'source' && (
            <Tabs defaultValue="paste" className="space-y-3">
              <TabsList>
                <TabsTrigger value="paste"><FileText className="mr-2 h-4 w-4" />Paste</TabsTrigger>
                <TabsTrigger value="upload"><Upload className="mr-2 h-4 w-4" />Upload</TabsTrigger>
              </TabsList>
              <TabsContent value="paste" className="space-y-2">
                <Textarea
                  className="font-mono text-xs h-[280px]"
                  placeholder="$ORIGIN example.com.&#10;$TTL 3600&#10;@ IN SOA ns1 admin 1 7200 3600 1209600 3600&#10;@ IN NS ns1.example.com.&#10;@ IN A 192.0.2.1&#10;..."
                  value={content}
                  onChange={(e) => { setContent(e.target.value); setFileName(null); }}
                />
                <p className="text-xs text-muted-foreground">{content.length.toLocaleString()} characters</p>
              </TabsContent>
              <TabsContent value="upload" className="space-y-2">
                <Input
                  type="file"
                  accept=".zone,.txt,.db,.bind"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                {fileName && (
                  <p className="text-xs text-muted-foreground">
                    Loaded <span className="font-mono">{fileName}</span> — {content.length.toLocaleString()} chars
                  </p>
                )}
              </TabsContent>
            </Tabs>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-4">
              <ImportPreviewTable preview={preview} />

              {mode.type === 'create' && (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Zone settings</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="im-zone-name">Zone name</Label>
                      <Input id="im-zone-name" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Kind</Label>
                      <Select value={kind} onValueChange={(v) => setKind(v as 'Native' | 'Master' | 'Slave')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Native">Native</SelectItem>
                          <SelectItem value="Master">Master</SelectItem>
                          <SelectItem value="Slave">Slave</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>SOA-EDIT-API</Label>
                      <Select value={soaEditApi} onValueChange={setSoaEditApi}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DEFAULT">DEFAULT</SelectItem>
                          <SelectItem value="INCEPTION-INCREMENT">INCEPTION-INCREMENT</SelectItem>
                          <SelectItem value="INCEPTION-EPOCH">INCEPTION-EPOCH</SelectItem>
                          <SelectItem value="EPOCH">EPOCH</SelectItem>
                          <SelectItem value="NONE">NONE</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Nameservers</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="ns1.example.com"
                          value={nameserverInput}
                          onChange={(e) => setNameserverInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNameserver(); } }}
                        />
                        <Button type="button" variant="outline" onClick={addNameserver}>Add</Button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {nameservers.map((ns) => (
                          <button
                            key={ns}
                            type="button"
                            onClick={() => removeNameserver(ns)}
                            className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs font-mono hover:bg-destructive hover:text-destructive-foreground"
                          >
                            {ns} ×
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="im-account">Account (optional)</Label>
                      <Input id="im-account" value={account} onChange={(e) => setAccount(e.target.value)} />
                    </div>
                    <div className="flex items-center justify-between border rounded-md px-3 py-2">
                      <Label htmlFor="im-dnssec" className="text-sm">DNSSEC</Label>
                      <Switch id="im-dnssec" checked={dnssec} onCheckedChange={setDnssec} />
                    </div>
                  </div>
                </div>
              )}

              {mode.type === 'merge' && (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Strategy</h3>
                  <RadioGroup value={mergeStrategy} onValueChange={(v) => setMergeStrategy(v as 'merge' | 'replace')}>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="merge" id="strat-merge" className="mt-1" />
                      <div>
                        <Label htmlFor="strat-merge" className="cursor-pointer">Merge</Label>
                        <p className="text-xs text-muted-foreground">
                          Add records that don&apos;t exist; update records that differ. Existing records not in the import file are kept.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="replace" id="strat-replace" className="mt-1" />
                      <div>
                        <Label htmlFor="strat-replace" className="cursor-pointer">Replace all</Label>
                        <p className="text-xs text-muted-foreground">
                          Make the zone match the imported file exactly. Records not in the file will be deleted (except SOA, and apex NS if &ldquo;Skip apex NS&rdquo; is on).
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                  <div className="flex flex-col gap-2 pt-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={skipSoa} onCheckedChange={(v) => setSkipSoa(!!v)} />
                      Skip SOA from import (recommended; SOA is auto-managed by PowerDNS)
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={skipApexNs} onCheckedChange={(v) => setSkipApexNs(!!v)} />
                      Skip apex NS from import (recommended; preserves the zone&apos;s nameservers)
                    </label>
                  </div>
                </div>
              )}

              {submitError && (
                <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
              )}
            </div>
          )}

          {step === 'submitting' && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {parseError && step === 'source' && (
            <p className="text-sm text-red-600 dark:text-red-400">{parseError}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'preview' && (
            <Button variant="ghost" onClick={() => setStep('source')}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={step === 'submitting'}>
            Cancel
          </Button>
          {step === 'source' && (
            <Button onClick={handlePreview} disabled={isParsing || !content.trim()}>
              {isParsing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Parsing</> : 'Preview'}
            </Button>
          )}
          {step === 'preview' && (
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              {mode.type === 'create' ? 'Import & create zone' : 'Stage changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function rrsetEqual(a: RRSet, b: RRSet): boolean {
  if (a.name !== b.name || a.type !== b.type || a.ttl !== b.ttl) return false;
  if (a.records.length !== b.records.length) return false;
  const sortedA = [...a.records].sort((x, y) => x.content.localeCompare(y.content));
  const sortedB = [...b.records].sort((x, y) => x.content.localeCompare(y.content));
  return sortedA.every((r, i) => r.content === sortedB[i].content && r.disabled === sortedB[i].disabled);
}
