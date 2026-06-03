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
  // Must throw on failure so the error is shown inside the dialog.
  onSubmit: (payload: Partial<Zone>) => Promise<void>;
}

export function ZoneSettingsDialog({
  open,
  onOpenChange,
  zone,
  onSubmit,
}: ZoneSettingsDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [masterInput, setMasterInput] = React.useState('');

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
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update zone settings');
    } finally {
      setIsSubmitting(false);
    }
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

            {/* Account */}
            <div className="space-y-2">
              <Label htmlFor="account">Account</Label>
              <Input id="account" placeholder="Account name" {...form.register('account')} />
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
