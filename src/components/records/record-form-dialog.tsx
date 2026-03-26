'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Textarea } from '@/components/ui/textarea';
import type { RRSet, RecordType } from '@/types/powerdns';
import { hasStructuredFields } from '@/lib/record-fields';
import { StructuredContentFields } from '@/components/records/structured-content-fields';

const RECORD_TYPES: RecordType[] = [
  'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR', 'CAA',
  'ALIAS', 'DNSKEY', 'DS', 'NAPTR', 'SSHFP', 'TLSA', 'URI',
];

const recordSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1, 'Type is required'),
  ttl: z.number().min(1, 'TTL must be at least 1'),
  content: z.string().min(1, 'Content is required'),
  disabled: z.boolean().default(false),
  priority: z.number().optional(),
  comment: z.string().optional(),
});

type RecordFormData = z.infer<typeof recordSchema>;

interface RecordFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zoneName: string;
  record?: RRSet;
  onSubmit: (data: RecordFormData) => Promise<void>;
}

export function RecordFormDialog({
  open,
  onOpenChange,
  zoneName,
  record,
  onSubmit,
}: RecordFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const isEditing = !!record;

  const form = useForm<RecordFormData>({
    resolver: zodResolver(recordSchema),
    defaultValues: {
      name: '',
      type: 'A',
      ttl: 3600,
      content: '',
      disabled: false,
      priority: undefined,
      comment: '',
    },
  });

  const { watch, setValue, reset, handleSubmit, formState: { errors } } = form;
  const recordType = watch('type');

  React.useEffect(() => {
    if (record) {
      const name = record.name === zoneName || record.name === `${zoneName}.`
        ? '@'
        : record.name.replace(`.${zoneName}`, '').replace(zoneName, '').replace(/\.$/, '') || '@';

      reset({
        name,
        type: record.type,
        ttl: record.ttl,
        content: record.records[0]?.content || '',
        disabled: record.records[0]?.disabled || false,
        comment: record.comments?.[0]?.content || '',
      });
    } else {
      reset({
        name: '',
        type: 'A',
        ttl: 3600,
        content: '',
        disabled: false,
        comment: '',
      });
    }
  }, [record, zoneName, reset]);

  const onFormSubmit = async (data: RecordFormData) => {
    setIsSubmitting(true);
    try {
      await onSubmit(data);
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save record:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPlaceholder = (type: string): string => {
    const placeholders: Record<string, string> = {
      A: '192.168.1.1',
      AAAA: '2001:db8::1',
      CNAME: 'target.example.com.',
      MX: '10 mail.example.com.',
      TXT: '"v=spf1 mx ~all"',
      NS: 'ns1.example.com.',
      SRV: '10 5 5060 sipserver.example.com.',
      PTR: 'host.example.com.',
      CAA: '0 issue "letsencrypt.org"',
    };
    return placeholders[type] || 'Record content';
  };

  const getHelperText = (type: string): string | null => {
    const helpers: Record<string, string> = {
      A: 'IPv4 address',
      AAAA: 'IPv6 address',
      CNAME: 'Canonical name (must end with a dot)',
      MX: 'Priority and mail server (e.g., "10 mail.example.com.")',
      TXT: 'Text record (must be quoted)',
      NS: 'Nameserver (must end with a dot)',
      SRV: 'Priority Weight Port Target',
      PTR: 'Pointer record (must end with a dot)',
      CAA: 'Flags Tag Value',
    };
    return helpers[type] || null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Record' : 'Add Record'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Modify the DNS record' : `Add a new DNS record to ${zoneName}`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Name */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="name"
                  placeholder="@ or subdomain"
                  {...form.register('name')}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">.{zoneName}</span>
              </div>
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={recordType}
                onValueChange={(value) => setValue('type', value)}
                disabled={isEditing}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* TTL */}
            <div className="space-y-2">
              <Label htmlFor="ttl">TTL (seconds)</Label>
              <Select
                value={watch('ttl').toString()}
                onValueChange={(value) => setValue('ttl', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">1 minute</SelectItem>
                  <SelectItem value="300">5 minutes</SelectItem>
                  <SelectItem value="900">15 minutes</SelectItem>
                  <SelectItem value="1800">30 minutes</SelectItem>
                  <SelectItem value="3600">1 hour</SelectItem>
                  <SelectItem value="7200">2 hours</SelectItem>
                  <SelectItem value="14400">4 hours</SelectItem>
                  <SelectItem value="28800">8 hours</SelectItem>
                  <SelectItem value="43200">12 hours</SelectItem>
                  <SelectItem value="86400">1 day</SelectItem>
                  <SelectItem value="604800">1 week</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Content */}
            {hasStructuredFields(recordType) ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>Content</Label>
                <StructuredContentFields
                  key={recordType}
                  recordType={recordType}
                  initialContent={record?.records[0]?.content || ''}
                  onContentChange={(content) => setValue('content', content, { shouldValidate: true })}
                />
                {errors.content && (
                  <p className="text-sm text-destructive">{errors.content.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="content">Content</Label>
                {recordType === 'TXT' ? (
                  <Textarea
                    id="content"
                    placeholder={getPlaceholder(recordType)}
                    {...form.register('content')}
                    rows={3}
                  />
                ) : (
                  <Input
                    id="content"
                    placeholder={getPlaceholder(recordType)}
                    {...form.register('content')}
                  />
                )}
                {getHelperText(recordType) && (
                  <p className="text-sm text-muted-foreground">
                    {getHelperText(recordType)}
                  </p>
                )}
                {errors.content && (
                  <p className="text-sm text-destructive">{errors.content.message}</p>
                )}
              </div>
            )}

            {/* Comment */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="comment">Comment</Label>
              <Textarea
                id="comment"
                placeholder="Optional note about this record..."
                {...form.register('comment')}
                rows={2}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Stored in PowerDNS as a comment on this RRSet
              </p>
            </div>

            {/* Disabled Toggle */}
            <div className="flex items-center justify-between sm:col-span-2 p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="disabled">Disabled</Label>
                <p className="text-sm text-muted-foreground">
                  Temporarily disable this record
                </p>
              </div>
              <Switch
                id="disabled"
                checked={watch('disabled')}
                onCheckedChange={(checked) => setValue('disabled', checked)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Update Record' : 'Add Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
