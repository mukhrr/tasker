'use client';

import Link from 'next/link';
import {
  RefreshCw,
  Trash2,
  Eye,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  TimerReset,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

const ICON_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50';

/** One icon button in the spread-out (lg and up) action bar, labelled by tooltip. */
function InlineAction({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TaskRowActions({
  taskId,
  isSyncing,
  isConfirmingDelete,
  isArchived,
  isStale,
  onSync,
  onDelete,
  onRequestDelete,
  onCancelDelete,
  onArchive,
  onClearHighlight,
}: {
  taskId: string;
  isSyncing: boolean;
  isConfirmingDelete: boolean;
  isArchived: boolean;
  /** Row is currently stale-highlighted — only then is clearing it meaningful. */
  isStale: boolean;
  onSync: () => void;
  onDelete: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onArchive: () => void;
  onClearHighlight: () => void;
}) {
  if (isConfirmingDelete) {
    return (
      <div className="flex items-center justify-end gap-1.5">
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
    <>
      {/* Wide screens: spread the actions out, no menu to open. */}
      <TooltipProvider delay={400}>
        <div className="hidden items-center justify-end gap-0.5 lg:flex">
          {!isArchived && (
            <InlineAction label="Sync">
              <button
                disabled={isSyncing}
                onClick={onSync}
                aria-label="Sync"
                className={ICON_BUTTON}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
              </button>
            </InlineAction>
          )}
          {isStale && !isArchived && (
            <InlineAction label="Clear highlight">
              <button
                onClick={onClearHighlight}
                aria-label="Clear highlight"
                className={ICON_BUTTON}
              >
                <TimerReset className="h-4 w-4" />
              </button>
            </InlineAction>
          )}
          <InlineAction label="View">
            <Link
              href={`/tasks/${taskId}`}
              aria-label="View"
              className={ICON_BUTTON}
            >
              <Eye className="h-4 w-4" />
            </Link>
          </InlineAction>
          <InlineAction label={isArchived ? 'Unarchive' : 'Archive'}>
            <button
              onClick={onArchive}
              aria-label={isArchived ? 'Unarchive' : 'Archive'}
              className={ICON_BUTTON}
            >
              {isArchived ? (
                <ArchiveRestore className="h-4 w-4" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </button>
          </InlineAction>
          {!isArchived && (
            <InlineAction label="Delete">
              <button
                onClick={onRequestDelete}
                aria-label="Delete"
                className={`${ICON_BUTTON} hover:bg-destructive/10 hover:text-destructive`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </InlineAction>
          )}
        </div>
      </TooltipProvider>

      {/* Narrow screens: same actions, collapsed into a menu. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              aria-label="Row actions"
              className={`${ICON_BUTTON} lg:hidden`}
            />
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
          {isStale && !isArchived && (
            <DropdownMenuItem onClick={onClearHighlight}>
              <TimerReset className="h-3.5 w-3.5" />
              Clear highlight
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
    </>
  );
}
