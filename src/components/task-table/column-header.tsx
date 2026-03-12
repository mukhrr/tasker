'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';

export function ColumnHeader({
  name,
  isCustom,
  onRename,
  onDelete,
}: {
  name: string;
  isCustom?: boolean;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);

  if (renaming && onRename) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onRename(draft.trim() || name);
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onRename(draft.trim() || name);
            setRenaming(false);
          }
          if (e.key === 'Escape') {
            setDraft(name);
            setRenaming(false);
          }
        }}
        className="h-6 text-sm font-medium"
      />
    );
  }

  if (!isCustom) {
    return <span className="text-sm font-medium text-muted-foreground">{name}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        {name}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => setRenaming(true)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDelete}
          className="text-destructive"
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
