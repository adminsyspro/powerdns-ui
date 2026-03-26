'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getRecordFieldConfig } from '@/lib/record-fields';

interface StructuredContentFieldsProps {
  recordType: string;
  initialContent: string;
  onContentChange: (content: string) => void;
}

export function StructuredContentFields({
  recordType,
  initialContent,
  onContentChange,
}: StructuredContentFieldsProps) {
  const config = getRecordFieldConfig(recordType);
  const onContentChangeRef = React.useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const [fields, setFields] = React.useState<Record<string, string>>(() => {
    if (!config) return {};
    if (initialContent) {
      return config.parse(initialContent);
    }
    const defaults: Record<string, string> = {};
    for (const field of config.fields) {
      if (field.type === 'select' && field.selectOptions?.length) {
        defaults[field.name] = field.selectOptions[0].value;
      } else {
        defaults[field.name] = '';
      }
    }
    return defaults;
  });

  // Propagate built content to parent whenever fields change
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (!config) return;
    // Skip the first render to avoid overwriting the initial content with a rebuilt version
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // Still sync on first render if there was no initial content (new record)
      if (!initialContent) {
        onContentChangeRef.current(config.build(fields));
      }
      return;
    }
    onContentChangeRef.current(config.build(fields));
  }, [fields, config]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) return null;

  const handleFieldChange = (name: string, value: string) => {
    setFields((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {config.fields.map((field) => (
        <div
          key={field.name}
          className={`space-y-2 ${field.width === 'full' ? 'sm:col-span-2' : ''}`}
        >
          <Label htmlFor={`field-${field.name}`}>{field.label}</Label>
          {field.type === 'select' && field.selectOptions ? (
            <Select
              value={fields[field.name] || field.selectOptions[0]?.value || ''}
              onValueChange={(value) => handleFieldChange(field.name, value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={field.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {field.selectOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`field-${field.name}`}
              type={field.type === 'number' ? 'number' : 'text'}
              placeholder={field.placeholder}
              value={fields[field.name] || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              min={field.min}
              max={field.max}
            />
          )}
          {field.helperText && (
            <p className="text-xs text-muted-foreground">{field.helperText}</p>
          )}
        </div>
      ))}
    </div>
  );
}
