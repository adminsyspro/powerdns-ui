'use client';

import * as React from 'react';
import { Shield, ShieldOff, Plus, Trash2, Copy, Check, Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Zone, CryptoKey } from '@/types/powerdns';
import { copyToClipboard } from '@/lib/utils';
import * as api from '@/lib/api';

// Algorithms PowerDNS can generate keys for (mnemonics accepted by the API).
const ALGORITHMS = ['ECDSAP256SHA256', 'ECDSAP384SHA384', 'ED25519', 'ED448', 'RSASHA256', 'RSASHA512'];

interface DnssecDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: Zone;
  // Enable/disable signing and manage keys (Administrator / Operator).
  canManage: boolean;
  // Called after any change that affects the zone object (dnssec flag, keys).
  // Awaited while `busy` blocks further edits, so a slow cache sync can't be
  // raced by a second key change (useZoneSync.sync() skips while isSyncing).
  onZoneChanged: () => void | Promise<void>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 flex-shrink-0"
      onClick={() => {
        copyToClipboard(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function DnssecDialog({ open, onOpenChange, zone, canManage, onZoneChanged }: DnssecDialogProps) {
  const [keys, setKeys] = React.useState<CryptoKey[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmDisable, setConfirmDisable] = React.useState(false);
  const [showAddKey, setShowAddKey] = React.useState(false);
  const [newKeyType, setNewKeyType] = React.useState<'csk' | 'ksk' | 'zsk'>('csk');
  const [newKeyAlgorithm, setNewKeyAlgorithm] = React.useState('ECDSAP256SHA256');

  const loadKeys = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await api.fetchCryptokeys(zone.id);
    if (result.data) setKeys(result.data);
    else setError(result.error || 'Failed to load DNSSEC keys');
    setIsLoading(false);
  }, [zone.id]);

  React.useEffect(() => {
    if (open) {
      setError(null);
      setConfirmDisable(false);
      setShowAddKey(false);
      if (zone.dnssec) loadKeys();
      else setKeys([]);
    }
  }, [open, zone.dnssec, loadKeys]);

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    const result = await api.updateZoneProperties(zone.id, { dnssec: true });
    if (result.error) {
      setError(result.error);
    } else {
      // Signing an existing zone requires a rectify so NSEC/NSEC3 ordering is
      // written; best-effort since api-rectify may already cover it.
      await api.rectifyZone(zone.id);
      await Promise.all([onZoneChanged(), loadKeys()]);
    }
    setBusy(false);
  };

  const handleDisable = async () => {
    setBusy(true);
    setError(null);
    const result = await api.updateZoneProperties(zone.id, { dnssec: false });
    if (result.error) {
      setError(result.error);
    } else {
      setConfirmDisable(false);
      setKeys([]);
      await onZoneChanged();
    }
    setBusy(false);
  };

  const handleToggleKey = async (key: CryptoKey) => {
    setBusy(true);
    setError(null);
    const result = await api.updateCryptokey(zone.id, key.id, { active: !key.active });
    if (result.error) setError(result.error);
    else {
      // (De)activating a key can flip the zone's effective DNSSEC status.
      await Promise.all([onZoneChanged(), loadKeys()]);
    }
    setBusy(false);
  };

  const handleDeleteKey = async (key: CryptoKey) => {
    setBusy(true);
    setError(null);
    const result = await api.deleteCryptokey(zone.id, key.id);
    if (result.error) setError(result.error);
    else {
      await Promise.all([onZoneChanged(), loadKeys()]);
    }
    setBusy(false);
  };

  const handleAddKey = async () => {
    setBusy(true);
    setError(null);
    const result = await api.createCryptokey(zone.id, {
      keytype: newKeyType,
      active: true,
      algorithm: newKeyAlgorithm,
    });
    if (result.error) setError(result.error);
    else {
      setShowAddKey(false);
      await Promise.all([onZoneChanged(), loadKeys()]);
    }
    setBusy(false);
  };

  const zoneLabel = zone.name.replace(/\.$/, '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            DNSSEC — {zoneLabel}
          </DialogTitle>
          <DialogDescription>
            {zone.dnssec
              ? 'This zone is signed. Publish the DS record(s) below at the parent zone / registrar.'
              : 'This zone is not signed.'}
          </DialogDescription>
        </DialogHeader>

        {!zone.dnssec ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border p-4 text-sm">
              <ShieldOff className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">DNSSEC is disabled</p>
                <p className="text-muted-foreground">
                  Enabling DNSSEC signs the zone with a default key (single CSK, ECDSAP256SHA256)
                  and rectifies it. Useful for zones received unsigned via incoming transfer that
                  must be signed locally. You can then add or replace keys as needed.
                </p>
              </div>
            </div>
            {canManage && (
              <Button onClick={handleEnable} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
                Enable DNSSEC
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Keys */}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map((key) => (
                  <div key={key.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono">#{key.id}</Badge>
                      <Badge>{key.keytype.toUpperCase()}</Badge>
                      <span className="text-sm font-mono">{key.algorithm}</span>
                      {key.bits > 0 && <span className="text-xs text-muted-foreground">{key.bits} bits</span>}
                      <Badge variant={key.active ? 'default' : 'secondary'} className={key.active ? 'bg-green-600' : ''}>
                        {key.active ? 'Active' : 'Inactive'}
                      </Badge>
                      {!key.published && <Badge variant="secondary">Not published</Badge>}
                      {canManage && (
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleToggleKey(key)}
                          >
                            {key.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            disabled={busy}
                            onClick={() => handleDeleteKey(key)}
                            aria-label={`Delete key ${key.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {key.ds && key.ds.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">DS records (for the registrar)</p>
                        {key.ds.map((ds) => (
                          <div key={ds} className="flex items-center gap-1">
                            <code className="flex-1 rounded bg-muted px-2 py-1 text-xs font-mono break-all">{ds}</code>
                            <CopyButton text={ds} />
                          </div>
                        ))}
                      </div>
                    )}
                    {key.dnskey && (
                      <div className="flex items-center gap-1">
                        <code className="flex-1 rounded bg-muted px-2 py-1 text-xs font-mono truncate" title={key.dnskey}>
                          DNSKEY {key.dnskey}
                        </code>
                        <CopyButton text={key.dnskey} />
                      </div>
                    )}
                  </div>
                ))}
                {keys.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">
                    No cryptokeys found (the zone may be signed presigned or via metadata).
                  </p>
                )}
              </div>
            )}

            {/* Add key */}
            {canManage && (
              showAddKey ? (
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="dnssec-keytype">Key type</Label>
                      <Select value={newKeyType} onValueChange={(v) => setNewKeyType(v as 'csk' | 'ksk' | 'zsk')}>
                        <SelectTrigger id="dnssec-keytype">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="csk">CSK (combined signing key)</SelectItem>
                          <SelectItem value="ksk">KSK (key signing key)</SelectItem>
                          <SelectItem value="zsk">ZSK (zone signing key)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dnssec-algo">Algorithm</Label>
                      <Select value={newKeyAlgorithm} onValueChange={setNewKeyAlgorithm}>
                        <SelectTrigger id="dnssec-algo">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALGORITHMS.map((algo) => (
                            <SelectItem key={algo} value={algo}>{algo}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" onClick={handleAddKey} disabled={busy}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create key
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowAddKey(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowAddKey(true)}>
                  <Plus className="mr-2 h-4 w-4" />Add key
                </Button>
              )
            )}

            {/* Disable DNSSEC */}
            {canManage && (
              <div className="border-t pt-4">
                {confirmDisable ? (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive flex-shrink-0" />
                    <div className="space-y-2">
                      <p>
                        Disabling DNSSEC deletes <strong>all keys</strong> and unsigns the zone. If DS
                        records are still published at the registrar, resolvers will fail to validate
                        the zone. Remove the DS at the parent first.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="destructive" size="sm" onClick={handleDisable} disabled={busy}>
                          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Disable and delete keys
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDisable(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDisable(true)}>
                    <ShieldOff className="mr-2 h-4 w-4" />Disable DNSSEC
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
