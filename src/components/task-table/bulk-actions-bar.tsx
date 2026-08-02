'use client';

import { useState } from 'react';
import { startOfDay } from 'date-fns';
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  getStatusColor,
  getStatusesByGroup,
  STATUS_GROUP_LABELS,
} from '@/lib/status';
import type { Task, UserStatus } from '@/types/database';

/** Date → the `YYYY-MM-DD` shape the date columns are stored in. */
function toDateString(date: Date | null): string | null {
  if (!date) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function BulkActionsBar({
  selectedCount,
  statuses,
  isArchivedView,
  onStatusChange,
  onUpdate,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  statuses: UserStatus[];
  /** The archived tab shows Restore instead of Archive. */
  isArchivedView: boolean;
  onStatusChange: (statusKey: string) => void;
  onUpdate: (updates: Partial<Task>, description: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (selectedCount === 0) return null;

  const today = startOfDay(new Date());

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-border" />

      {/* Status */}
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2">
              <CircleDot className="h-3.5 w-3.5" />
              Status
            </Button>
          }
        />
        <PopoverContent align="start" className="w-56">
          <div className="max-h-72 overflow-y-auto">
            {Object.entries(getStatusesByGroup(statuses)).map(
              ([group, groupStatuses]) =>
                groupStatuses.length > 0 && (
                  <div key={group}>
                    <p className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {
                        STATUS_GROUP_LABELS[
                          group as keyof typeof STATUS_GROUP_LABELS
                        ]
                      }
                    </p>
                    {groupStatuses.map((s) => {
                      const color = getStatusColor(s.color);
                      return (
                        <button
                          key={s.key}
                          onClick={() => {
                            setStatusOpen(false);
                            onStatusChange(s.key);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted"
                        >
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`}
                          />
                          <span className="flex-1 truncate text-left">
                            {s.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Payment date — matches the payment column's rule (today onward). */}
      <DatePicker
        value={null}
        onChange={(date) =>
          onUpdate(
            { payment_date: toDateString(date) },
            date ? 'Payment date set' : 'Payment date cleared'
          )
        }
        disableDate={(d) => d < today}
        placeholder="Payment date"
        className="h-8 text-sm"
      />

      {/* Assigned date — matches the assigned column's rule (today back). */}
      <DatePicker
        value={null}
        onChange={(date) =>
          onUpdate(
            { assigned_date: toDateString(date) },
            date ? 'Assigned date set' : 'Assigned date cleared'
          )
        }
        disableDate={(d) => d > today}
        placeholder="Assigned date"
        className="h-8 text-sm"
      />

      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() =>
          onUpdate(
            { archived: !isArchivedView },
            isArchivedView ? 'Restored' : 'Archived'
          )
        }
      >
        {isArchivedView ? (
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
      </Button>

      {confirmingDelete ? (
        <div className="flex items-center gap-1.5">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
          >
            Delete {selectedCount}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-destructive hover:text-destructive"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto gap-2 text-muted-foreground"
        onClick={onClear}
      >
        <X className="h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
