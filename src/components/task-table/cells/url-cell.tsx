'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { shortenGitHubUrl } from '@/lib/github';

export function UrlCell({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
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
      />
    );
  }

  if (!value) {
    return (
      <span
        onClick={() => setEditing(true)}
        className="cursor-pointer text-sm text-muted-foreground"
      >
        —
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
        onClick={(e) => e.stopPropagation()}
      >
        {shortenGitHubUrl(value)}
      </a>
      <button
        onClick={() => setEditing(true)}
        className="ml-auto shrink-0 opacity-0 group-hover/row:opacity-100 text-sm text-muted-foreground hover:text-foreground"
      >
        Edit
      </button>
    </div>
  );
}
