'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';

export function DateCell({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Input
        type="date"
        autoFocus
        defaultValue={value ?? ''}
        onBlur={(e) => {
          setEditing(false);
          onChange(e.target.value || null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-8 text-sm"
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer text-sm text-foreground"
    >
      {value
        ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—'}
    </span>
  );
}
