'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';

export function AmountCell({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? '');

  const commit = () => {
    setEditing(false);
    const num = parseFloat(draft);
    onChange(isNaN(num) ? null : num);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value?.toString() ?? '');
            setEditing(false);
          }
        }}
        className="h-8 w-24 text-sm"
        placeholder="0.00"
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer text-sm text-foreground"
    >
      {value != null
        ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '—'}
    </span>
  );
}
