'use client';

import Link from 'next/link';
import {
  RefreshCw,
  Trash2,
  Eye,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export function TaskRowActions({
  taskId,
  isSyncing,
  isConfirmingDelete,
  isArchived,
  onSync,
  onDelete,
  onRequestDelete,
  onCancelDelete,
  onArchive,
}: {
  taskId: string;
  isSyncing: boolean;
  isConfirmingDelete: boolean;
  isArchived: boolean;
  onSync: () => void;
  onDelete: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onArchive: () => void;
}) {
  if (isConfirmingDelete) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={onDelete}
          className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
        >
          Delete
        </button>
        <button
          onClick={onCancelDelete}
          className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
        {!isArchived && (
          <DropdownMenuItem disabled={isSyncing} onClick={onSync}>
            <RefreshCw
              className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
            />
            Sync
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link href={`/tasks/${taskId}`} />}>
          <Eye className="h-3.5 w-3.5" />
          View
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onArchive}>
          {isArchived ? (
            <>
              <ArchiveRestore className="h-3.5 w-3.5" />
              Unarchive
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5" />
              Archive
            </>
          )}
        </DropdownMenuItem>
        {!isArchived && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRequestDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
