'use client';

import Link from 'next/link';
import { RefreshCw, Trash2, Eye, Archive, ArchiveRestore } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

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

  if (isArchived) {
    return (
      <TooltipProvider delay={400}>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={onArchive}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                />
              }
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>Unarchive</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href={`/tasks/${taskId}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                />
              }
            >
              <Eye className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>View</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delay={400}>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={onSync}
                disabled={isSyncing}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              />
            }
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
            />
          </TooltipTrigger>
          <TooltipContent>Sync</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={onArchive}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              />
            }
          >
            <Archive className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={onRequestDelete}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-100 hover:text-destructive dark:hover:bg-red-950"
              />
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={`/tasks/${taskId}`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              />
            }
          >
            <Eye className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>View</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
