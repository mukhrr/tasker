'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { SortDirection } from './column-config';

export function ColumnHeader({
  name,
  isCustom,
  onRename,
  onDelete,
  sortDirection,
  onSort,
}: {
  name: string;
  isCustom?: boolean;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  sortDirection?: SortDirection | null;
  onSort?: () => void;
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
    return (
      <button
        onClick={onSort}
        className="flex cursor-pointer items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {name}
        {sortDirection === 'asc' && <ArrowUp className="h-3 w-3" />}
        {sortDirection === 'desc' && <ArrowDown className="h-3 w-3" />}
      </button>
    );
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
        <DropdownMenuItem onClick={onDelete} className="text-destructive">
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
