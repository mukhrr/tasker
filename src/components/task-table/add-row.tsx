'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';

export function AddRow({ onAdd }: { onAdd: (issueUrl: string) => void }) {
  const [active, setActive] = useState(false);
  const [url, setUrl] = useState('');

  const submit = () => {
    const trimmed = url.trim();
    if (trimmed) {
      onAdd(trimmed);
      setUrl('');
      setActive(false);
    }
  };

  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex w-full items-center gap-2 border-t px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Task
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t px-3 py-2 sm:px-4">
      <Input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste GitHub issue URL..."
        onBlur={() => {
          if (!url.trim()) setActive(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setUrl('');
            setActive(false);
          }
        }}
        className="h-8 text-sm"
      />
    </div>
  );
}
