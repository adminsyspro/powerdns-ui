'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { ZoneKind } from '@/types/powerdns';
import { useTemplatesStore } from '@/stores';

const createZoneSchema = z.object({
  name: z
    .string()
    .min(1, 'Zone name is required')
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.?$/, 'Invalid domain name'),
  kind: z.enum(['Native', 'Master', 'Slave'] as const),
  nameservers: z.array(z.string()).min(1, 'At least one nameserver is required'),
  masters: z.array(z.string()).optional(),
  account: z.string().optional(),
  dnssec: z.boolean().default(false),
  soaEditApi: z.string().optional(),
  template: z.string().optional(),
});

type CreateZoneFormData = z.infer<typeof createZoneSchema>;

interface CreateZoneDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSubmit?: (data: CreateZoneFormData) => Promise<void>;
  trigger?: React.ReactNode;
}

export function CreateZoneDialog({
  open,
  onOpenChange,
  onSubmit,
  trigger,
}: CreateZoneDialogProps) {
  const { templates } = useTemplatesStore();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [nameserverInput, setNameserverInput] = React.useState('');
  const [masterInput, setMasterInput] = React.useState('');

  const form = useForm<CreateZoneFormData>({
    resolver: zodResolver(createZoneSchema),
    defaultValues: {
      name: '',
      kind: 'Native',
      nameservers: ['ns1.example.com.', 'ns2.example.com.'],
      masters: [],
      account: '',
      dnssec: false,
      soaEditApi: 'DEFAULT',
      template: '',
    },
  });

  const { watch, setValue, handleSubmit, formState: { errors } } = form;
  const kind = watch('kind');
  const nameservers = watch('nameservers');
  const masters = watch('masters') || [];

  const addNameserver = () => {
    if (nameserverInput.trim()) {
      const ns = nameserverInput.trim().endsWith('.') 
        ? nameserverInput.trim() 
        : `${nameserverInput.trim()}.`;
      if (!nameservers.includes(ns)) {
        setValue('nameservers', [...nameservers, ns]);
      }
      setNameserverInput('');
    }
  };

  const removeNameserver = (ns: string) => {
    setValue('nameservers', nameservers.filter((n) => n !== ns));
  };

  const addMaster = () => {
    if (masterInput.trim()) {
      if (!masters.includes(masterInput.trim())) {
        setValue('masters', [...masters, masterInput.trim()]);
      }
      setMasterInput('');
    }
  };

  const removeMaster = (master: string) => {
    setValue('masters', masters.filter((m) => m !== master));
  };

  const onFormSubmit = async (data: CreateZoneFormData) => {
    setIsSubmitting(true);
    try {
      await onSubmit?.(data);
      form.reset();
      onOpenChange?.(false);
    } catch (error) {
      console.error('Failed to create zone:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Zone</DialogTitle>
          <DialogDescription>
            Add a new DNS zone to your PowerDNS server.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Zone Name */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Zone Name</Label>
              <Input
                id="name"
                placeholder="example.com"
                {...form.register('name')}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            {/* Zone Kind */}
            <div className="space-y-2">
              <Label htmlFor="kind">Zone Type</Label>
              <Select
                value={kind}
                onValueChange={(value) => setValue('kind', value as 'Native' | 'Master' | 'Slave')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Native">Native</SelectItem>
                  <SelectItem value="Master">Master</SelectItem>
                  <SelectItem value="Slave">Slave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Template */}
            <div className="space-y-2">
              <Label htmlFor="template">Template (Optional)</Label>
              <Select
                value={watch('template') || 'none'}
                onValueChange={(value) => setValue('template', value === 'none' ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Account */}
            <div className="space-y-2">
              <Label htmlFor="account">Account (Optional)</Label>
              <Input
                id="account"
                placeholder="Account name"
                {...form.register('account')}
              />
            </div>

            {/* SOA-EDIT-API */}
            <div className="space-y-2">
              <Label htmlFor="soaEditApi">SOA-EDIT-API</Label>
              <Select
                value={watch('soaEditApi') || 'DEFAULT'}
                onValueChange={(value) => setValue('soaEditApi', value)}
              >
                <SelectTrigger>
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

            {/* DNSSEC Toggle */}
            <div className="flex items-center justify-between sm:col-span-2 p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="dnssec">Enable DNSSEC</Label>
                <p className="text-sm text-muted-foreground">
                  Secure the zone with DNSSEC signing
                </p>
              </div>
              <Switch
                id="dnssec"
                checked={watch('dnssec')}
                onCheckedChange={(checked) => setValue('dnssec', checked)}
              />
            </div>

            {/* Nameservers */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Nameservers</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="ns1.example.com"
                  value={nameserverInput}
                  onChange={(e) => setNameserverInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addNameserver())}
                />
                <Button type="button" variant="outline" onClick={addNameserver}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {nameservers.map((ns) => (
                  <Badge key={ns} variant="secondary" className="gap-1">
                    {ns}
                    <button
                      type="button"
                      onClick={() => removeNameserver(ns)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              {errors.nameservers && (
                <p className="text-sm text-destructive">{errors.nameservers.message}</p>
              )}
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
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addMaster())}
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
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange?.(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Zone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
