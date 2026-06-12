'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, X, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { Zone, ZoneKind } from '@/types/powerdns';
import * as api from '@/lib/api';

const PRIMARY_KINDS: ZoneKind[] = ['Native', 'Master', 'Slave'];

const zoneSettingsSchema = z
  .object({
    kind: z.enum(['Native', 'Master', 'Slave', 'Producer', 'Consumer'] as const),
    masters: z.array(z.string()).default([]),
    account: z.string().optional(),
    soa_edit_api: z.string().optional(),
    api_rectify: z.boolean().default(false),
  })
  .refine((data) => data.kind !== 'Slave' || data.masters.length > 0, {
    message: 'At least one master is required for Slave zones',
    path: ['masters'],
  });

type ZoneSettingsFormData = z.infer<typeof zoneSettingsSchema>;

interface ZoneSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: Zone;
  // Groups the caller may assign the zone to (account). Admins get every group
  // plus an orphan option; non-admins only their own. Omit/empty → free-text.
  groups?: { slug: string; name: string }[];
  isAdmin?: boolean;
  // Must throw on failure so the error is shown inside the dialog.
  onSubmit: (payload: Partial<Zone>) => Promise<void>;
}

export function ZoneSettingsDialog({
  open,
  onOpenChange,
  zone,
  groups,
  isAdmin = false,
  onSubmit,
}: ZoneSettingsDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [masterInput, setMasterInput] = React.useState('');

  // Zone transfer (AXFR) metadata — loaded separately from the zone object.
  const [axfrAllow, setAxfrAllow] = React.useState<string[]>([]);
  const [alsoNotify, setAlsoNotify] = React.useState<string[]>([]);
  const [axfrInput, setAxfrInput] = React.useState('');
  const [notifyInput, setNotifyInput] = React.useState('');
  const metaOriginalsRef = React.useRef<{ axfr: string[]; notify: string[] }>({ axfr: [], notify: [] });

  const form = useForm<ZoneSettingsFormData>({
    resolver: zodResolver(zoneSettingsSchema),
    defaultValues: {
      kind: 'Native',
      masters: [],
      account: '',
      soa_edit_api: 'DEFAULT',
      api_rectify: false,
    },
  });

  const { watch, setValue, handleSubmit, reset, formState: { errors } } = form;
  const kind = watch('kind');
  const masters = watch('masters') || [];

  // Re-seed the form from the current zone every time the dialog opens.
  React.useEffect(() => {
    if (open) {
      reset({
        kind: zone.kind,
        masters: zone.masters || [],
        account: zone.account || '',
        soa_edit_api: zone.soa_edit_api || 'DEFAULT',
        api_rectify: zone.api_rectify || false,
      });
      setSubmitError(null);
      setMasterInput('');
      setAxfrInput('');
      setNotifyInput('');
      setAxfrAllow([]);
      setAlsoNotify([]);
      metaOriginalsRef.current = { axfr: [], notify: [] };
      Promise.all([
        api.fetchZoneMetadata(zone.id, 'ALLOW-AXFR-FROM'),
        api.fetchZoneMetadata(zone.id, 'ALSO-NOTIFY'),
      ]).then(([axfr, notify]) => {
        const axfrValues = axfr.data?.metadata ?? [];
        const notifyValues = notify.data?.metadata ?? [];
        setAxfrAllow(axfrValues);
        setAlsoNotify(notifyValues);
        metaOriginalsRef.current = { axfr: axfrValues, notify: notifyValues };
      });
    }
  }, [open, zone, reset]);

  const addMaster = () => {
    const value = masterInput.trim();
    if (value && !masters.includes(value)) {
      setValue('masters', [...masters, value], { shouldValidate: true });
    }
    setMasterInput('');
  };

  const removeMaster = (master: string) => {
    setValue('masters', masters.filter((m) => m !== master), { shouldValidate: true });
  };

  const onFormSubmit = async (data: ZoneSettingsFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Partial<Zone> = {
        kind: data.kind,
        account: data.account || '',
        soa_edit_api: data.soa_edit_api || 'DEFAULT',
        api_rectify: data.api_rectify,
        // Only send masters for Slave zones so switching away never clears them.
        ...(data.kind === 'Slave' ? { masters: data.masters } : {}),
      };
      await onSubmit(payload);

      // Persist transfer metadata only when it actually changed, so opening
      // the dialog without touching AXFR never writes metadata.
      const { axfr, notify } = metaOriginalsRef.current;
      if (JSON.stringify(axfrAllow) !== JSON.stringify(axfr)) {
        const result = await api.setZoneMetadata(zone.id, 'ALLOW-AXFR-FROM', axfrAllow);
        if (result.error) throw new Error(`ALLOW-AXFR-FROM: ${result.error}`);
      }
      if (JSON.stringify(alsoNotify) !== JSON.stringify(notify)) {
        const result = await api.setZoneMetadata(zone.id, 'ALSO-NOTIFY', alsoNotify);
        if (result.error) throw new Error(`ALSO-NOTIFY: ${result.error}`);
      }

      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update zone settings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addListValue = (
    value: string,
    list: string[],
    setList: (next: string[]) => void,
    setInput: (next: string) => void
  ) => {
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed)) setList([...list, trimmed]);
    setInput('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Zone Settings</DialogTitle>
          <DialogDescription>
            Edit metadata for {zone.name.replace(/\.$/, '')}. Records are not affected.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Zone Type */}
            <div className="space-y-2">
              <Label htmlFor="kind">Zone Type</Label>
              <Select
                value={kind}
                onValueChange={(value) =>
                  setValue('kind', value as ZoneKind, { shouldValidate: true })
                }
              >
                <SelectTrigger id="kind">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Native">Native</SelectItem>
                  <SelectItem value="Master">Master</SelectItem>
                  <SelectItem value="Slave">Slave</SelectItem>
                  {/* Preserve catalog kinds (Producer/Consumer) so they round-trip */}
                  {!PRIMARY_KINDS.includes(zone.kind) && (
                    <SelectItem value={zone.kind}>{zone.kind}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Account / Group — always a select sourced from the admin-managed
                group list (no free text, so technicians can't introduce typos). */}
            <div className="space-y-2">
              <Label htmlFor="account">
                Group{!isAdmin && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <Select
                value={watch('account') || (isAdmin ? '__orphan__' : '')}
                onValueChange={(value) => setValue('account', value === '__orphan__' ? '' : value, { shouldValidate: true })}
              >
                <SelectTrigger id="account">
                  <SelectValue placeholder="Select a group" />
                </SelectTrigger>
                <SelectContent>
                  {isAdmin && <SelectItem value="__orphan__">No group (orphan)</SelectItem>}
                  {(groups || []).map((g) => (
                    <SelectItem key={g.slug} value={g.slug}>{g.name}</SelectItem>
                  ))}
                  {/* Preserve a legacy account not matching any group so it round-trips */}
                  {watch('account') && !(groups || []).some((g) => g.slug === watch('account')) && (
                    <SelectItem value={watch('account') as string}>{watch('account')} (current)</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {(!groups || groups.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  No groups defined — manage the list in Administration &rarr; Groups
                </p>
              )}
              {!isAdmin && !watch('account') && (
                <p className="text-sm text-destructive">Group is required</p>
              )}
            </div>

            {/* SOA-EDIT-API */}
            <div className="space-y-2">
              <Label htmlFor="soa_edit_api">SOA-EDIT-API</Label>
              <Select
                value={watch('soa_edit_api') || 'DEFAULT'}
                onValueChange={(value) => setValue('soa_edit_api', value)}
              >
                <SelectTrigger id="soa_edit_api">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFAULT">DEFAULT</SelectItem>
                  <SelectItem value="INCEPTION-INCREMENT">INCEPTION-INCREMENT</SelectItem>
                  <SelectItem value="INCEPTION-EPOCH">INCEPTION-EPOCH</SelectItem>
                  <SelectItem value="EPOCH">EPOCH</SelectItem>
                  <SelectItem value="NONE">NONE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* API Rectify */}
            <div className="flex items-center justify-between sm:col-span-2 p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="api_rectify">API Rectify</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically rectify the zone after API changes
                </p>
              </div>
              <Switch
                id="api_rectify"
                checked={watch('api_rectify')}
                onCheckedChange={(checked) => setValue('api_rectify', checked)}
              />
            </div>

            {/* Masters (only for Slave zones) */}
            {kind === 'Slave' && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Master Servers</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="192.168.1.1"
                    value={masterInput}
                    onChange={(e) => setMasterInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addMaster();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addMaster}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {masters.map((master) => (
                    <Badge key={master} variant="secondary" className="gap-1">
                      {master}
                      <button
                        type="button"
                        onClick={() => removeMaster(master)}
                        aria-label={`Remove ${master}`}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                {errors.masters && (
                  <p className="text-sm text-destructive">{errors.masters.message}</p>
                )}
              </div>
            )}

            {/* Zone transfer (AXFR) permissions */}
            <div className="space-y-4 sm:col-span-2 p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label>Zone transfer (AXFR)</Label>
                <p className="text-sm text-muted-foreground">
                  Authorize secondary servers outside this PowerDNS to pull the zone, and notify them on changes.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="axfr-allow" className="text-sm font-normal">
                  Allowed AXFR sources <span className="text-muted-foreground">(IP or CIDR, e.g. 203.0.113.5 or 2001:db8::/48 — ALLOW-AXFR-FROM)</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="axfr-allow"
                    placeholder="203.0.113.5"
                    value={axfrInput}
                    onChange={(e) => setAxfrInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addListValue(axfrInput, axfrAllow, setAxfrAllow, setAxfrInput);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addListValue(axfrInput, axfrAllow, setAxfrAllow, setAxfrInput)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {axfrAllow.map((entry) => (
                    <Badge key={entry} variant="secondary" className="gap-1">
                      {entry}
                      <button
                        type="button"
                        onClick={() => setAxfrAllow(axfrAllow.filter((v) => v !== entry))}
                        aria-label={`Remove ${entry}`}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {axfrAllow.length === 0 && (
                    <p className="text-xs text-muted-foreground">No extra AXFR permission — only the server-wide allow-axfr-ips applies</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="also-notify" className="text-sm font-normal">
                  Also notify <span className="text-muted-foreground">(IP[:port] to NOTIFY on changes — ALSO-NOTIFY)</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="also-notify"
                    placeholder="203.0.113.5:53"
                    value={notifyInput}
                    onChange={(e) => setNotifyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addListValue(notifyInput, alsoNotify, setAlsoNotify, setNotifyInput);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addListValue(notifyInput, alsoNotify, setAlsoNotify, setNotifyInput)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {alsoNotify.map((entry) => (
                    <Badge key={entry} variant="secondary" className="gap-1">
                      {entry}
                      <button
                        type="button"
                        onClick={() => setAlsoNotify(alsoNotify.filter((v) => v !== entry))}
                        aria-label={`Remove ${entry}`}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Warning when switching to Slave */}
            {kind === 'Slave' && zone.kind !== 'Slave' && (
              <div className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 flex-shrink-0" />
                <span>
                  Switching to Slave: this zone will be populated by AXFR from its master(s).
                  Existing local records may be overwritten by the transfer.
                </span>
              </div>
            )}
          </div>

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Settings'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
