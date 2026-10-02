'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import type { CustomFieldType } from '@/types/database';

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Select' },
];

export function AddColumnButton({
  onAdd,
}: {
  onAdd: (name: string, type: CustomFieldType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');

  const submit = () => {
    if (name.trim()) {
      onAdd(name.trim(), type);
      setName('');
      setType('text');
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button className="flex h-full items-center px-2 text-muted-foreground hover:text-foreground" />
        }
      >
        <Plus className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="space-y-1.5">
          <Label className="text-xs">Column Name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priority"
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <div className="flex flex-wrap gap-1.5">
            {FIELD_TYPES.map((ft) => (
              <button
                key={ft.value}
                onClick={() => setType(ft.value)}
                className={`rounded-md px-2 py-1 text-xs ${
                  type === ft.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={submit} className="w-full">
          Add Column
        </Button>
      </PopoverContent>
    </Popover>
  );
}
