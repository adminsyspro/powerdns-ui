'use client';

import * as React from 'react';
import { Server } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { NameserverPool } from '@/lib/ns-pools';

interface NameserverPoolSelectProps {
  pools: NameserverPool[];
  onApply: (nameservers: string[]) => void;
  className?: string;
}

export function NameserverPoolSelect({ pools, onApply, className }: NameserverPoolSelectProps) {
  const [selectedPoolId, setSelectedPoolId] = React.useState('');

  if (pools.length === 0) return null;

  return (
    <div className={className}>
      <Select
        value={selectedPoolId}
        onValueChange={(poolId) => {
          setSelectedPoolId(poolId);
          const pool = pools.find((item) => item.id === poolId);
          if (pool) onApply(pool.nameservers);
        }}
      >
        <SelectTrigger>
          <Server className="mr-2 h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Apply a nameserver pool" />
        </SelectTrigger>
        <SelectContent>
          {pools.map((pool) => (
            <SelectItem key={pool.id} value={pool.id}>
              {pool.name}{pool.isDefault ? ' (default)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
