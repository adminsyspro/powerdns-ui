'use client';

import * as React from 'react';
import { Plus, Edit2, Trash2, Copy, Layers, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTemplatesStore } from '@/stores';
import { useConfirm } from '@/hooks/use-confirm';
import { formatDate, getRecordTypeColor, getRecordTypeRowColor } from '@/lib/utils';
import type { TemplateRecord, RecordType, ZoneTemplate } from '@/types/powerdns';

const RECORD_TYPES: RecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR', 'CAA'];

const PLACEHOLDERS: Record<string, string> = {
  A: '192.168.1.1',
  AAAA: '2001:db8::1',
  CNAME: 'target.example.com.',
  MX: '10 mail.example.com.',
  TXT: '"v=spf1 mx ~all"',
  NS: 'ns1.example.com.',
  SRV: '10 5 5060 sip.example.com.',
  PTR: 'host.example.com.',
  CAA: '0 issue "letsencrypt.org"',
};

interface ValidationError {
  field: string;
  message: string;
}

function validateTemplate(name: string, records: TemplateRecord[]): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!name.trim()) errors.push({ field: 'name', message: 'Template name is required' });
  if (records.length === 0) errors.push({ field: 'records', message: 'At least one record is required' });

  const hasNS = records.some((r) => r.type === 'NS');
  if (!hasNS) errors.push({ field: 'records', message: 'At least one NS record is required' });

  records.forEach((r, i) => {
    if (!r.content.trim()) errors.push({ field: `record-${i}`, message: `Record #${i + 1}: content is required` });
    if (r.ttl < 1) errors.push({ field: `record-${i}`, message: `Record #${i + 1}: TTL must be >= 1` });
    if (['CNAME', 'NS', 'MX', 'PTR', 'SRV'].includes(r.type) && !r.content.endsWith('.') && !r.content.includes(' ')) {
      errors.push({ field: `record-${i}`, message: `Record #${i + 1} (${r.type}): value should end with a dot (e.g. ns1.example.com.)` });
    }
  });

  return errors;
}

// ---- Template Editor ----

function TemplateEditor({
  initial,
  onSave,
  onCancel
}: {
  initial?: ZoneTemplate;
  onSave: (name: string, description: string, records: TemplateRecord[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(initial?.name || '');
  const [description, setDescription] = React.useState(initial?.description || '');
  const [records, setRecords] = React.useState<TemplateRecord[]>(initial?.records || []);
  const [errors, setErrors] = React.useState<ValidationError[]>([]);

  // New record form
  const [newName, setNewName] = React.useState('@');
  const [newType, setNewType] = React.useState<RecordType>('A');
  const [newContent, setNewContent] = React.useState('');
  const [newTtl, setNewTtl] = React.useState(3600);

  const addRecord = () => {
    if (!newContent.trim()) return;
    setRecords([...records, { name: newName || '@', type: newType, content: newContent, ttl: newTtl }]);
    setNewContent('');
    setNewName('@');
    setErrors([]);
  };

  const removeRecord = (index: number) => {
    setRecords(records.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const validationErrors = validateTemplate(name, records);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    onSave(name, description, records);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Template Name *</Label>
          <Input placeholder="My Template" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Input placeholder="Optional description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {/* Records table */}
      <div className="space-y-2">
        <Label>Records *</Label>
        {records.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader className="bg-slate-100 dark:bg-slate-800">
                <TableRow>
                  <TableHead className="font-semibold">Name</TableHead>
                  <TableHead className="font-semibold w-[80px]">Type</TableHead>
                  <TableHead className="font-semibold w-[80px]">TTL</TableHead>
                  <TableHead className="font-semibold">Content</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record, i) => (
                  <TableRow key={i} className={getRecordTypeRowColor(record.type)}>
                    <TableCell className="text-sm font-mono">{record.name}</TableCell>
                    <TableCell className="text-sm font-medium">{record.type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{record.ttl}</TableCell>
                    <TableCell className="text-sm font-mono">{record.content}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeRecord(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add record row */}
        <div className="flex items-end gap-2 p-3 rounded-md border bg-muted/30">
          <div className="space-y-1 w-[100px]">
            <Label className="text-xs">Name</Label>
            <Input className="h-8 text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="@" />
          </div>
          <div className="space-y-1 w-[110px]">
            <Label className="text-xs">Type</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v as RecordType)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 w-[90px]">
            <Label className="text-xs">TTL</Label>
            <Select value={String(newTtl)} onValueChange={(v) => setNewTtl(parseInt(v))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="300">5 min</SelectItem>
                <SelectItem value="3600">1 hour</SelectItem>
                <SelectItem value="14400">4 hours</SelectItem>
                <SelectItem value="86400">1 day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Content</Label>
            <Input
              className="h-8 text-sm font-mono"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={PLACEHOLDERS[newType] || 'Value'}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecord(); } }}
            />
          </div>
          <Button size="sm" className="h-8" onClick={addRecord} disabled={!newContent.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
        </div>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 space-y-1">
          {errors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {err.message}
            </div>
          ))}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSave}>
          <Check className="mr-2 h-4 w-4" />
          {initial ? 'Update Template' : 'Create Template'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---- Main Page ----

export default function TemplatesPage() {
  const { templates, addTemplate, updateTemplate, removeTemplate } = useTemplatesStore();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<ZoneTemplate | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  const handleCreate = (name: string, description: string, records: TemplateRecord[]) => {
    addTemplate({ name, description, records });
    setDialogOpen(false);
  };

  const handleUpdate = (name: string, description: string, records: TemplateRecord[]) => {
    if (!editingTemplate) return;
    updateTemplate(editingTemplate.id, { name, description, records });
    setEditingTemplate(null);
  };

  const handleEdit = (template: ZoneTemplate) => {
    setEditingTemplate(template);
  };

  const handleDuplicate = (template: ZoneTemplate) => {
    addTemplate({
      name: `${template.name} (copy)`,
      description: template.description,
      records: [...template.records],
    });
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete template',
      description: 'Are you sure you want to delete this template?',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (ok) removeTemplate(id);
  };

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Zone Templates</h1>
          <p className="text-muted-foreground">Create and manage reusable zone templates</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />New Template
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Zone Template</DialogTitle>
            <DialogDescription>Define records that will be pre-filled when creating a new zone</DialogDescription>
          </DialogHeader>
          <TemplateEditor onSave={handleCreate} onCancel={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => { if (!open) setEditingTemplate(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template — {editingTemplate?.name}</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <TemplateEditor initial={editingTemplate} onSave={handleUpdate} onCancel={() => setEditingTemplate(null)} />
          )}
        </DialogContent>
      </Dialog>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No Templates</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-2">
              Create zone templates to quickly set up new domains with predefined records.
            </p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />Create Your First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{template.name}</CardTitle>
                  <div className="flex items-center gap-0.5">
                    <Tooltip><TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicate(template)}><Copy className="h-4 w-4" /></Button>
                    </TooltipTrigger><TooltipContent>Duplicate</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(template)}><Edit2 className="h-4 w-4" /></Button>
                    </TooltipTrigger><TooltipContent>Edit</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(template.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
                  </div>
                </div>
                <CardDescription>{template.description || 'No description'}</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Mini records preview */}
                <div className="rounded-md border">
                  <Table>
                    <TableBody>
                      {template.records.map((record, i) => (
                        <TableRow key={i} className={getRecordTypeRowColor(record.type)}>
                          <TableCell className="text-xs font-mono py-1.5">{record.name}</TableCell>
                          <TableCell className="text-xs font-medium py-1.5 w-[50px]">{record.type}</TableCell>
                          <TableCell className="text-xs text-muted-foreground py-1.5 w-[50px]">{record.ttl}</TableCell>
                          <TableCell className="text-xs font-mono py-1.5">{record.content}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {template.records.length} record{template.records.length !== 1 ? 's' : ''} &bull; Created {formatDate(template.createdAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
    <ConfirmDialog />
    </TooltipProvider>
  );
}
