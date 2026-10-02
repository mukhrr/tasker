'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { HighlightText } from '../highlight-text';

export function TextCell({
  value,
  onChange,
  placeholder,
  highlight,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  highlight?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    onChange(trimmed || null);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value ?? '');
            setEditing(false);
          }
        }}
        className="h-8 text-sm"
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer truncate text-sm text-foreground"
    >
      {value ? <HighlightText text={value} query={highlight ?? ''} /> : '—'}
    </span>
  );
}
