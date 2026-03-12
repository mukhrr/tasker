'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { STATUS_CONFIG, STATUS_GROUPS, STATUS_GROUP_LABELS } from '@/lib/status';
import type { TaskStatus, TaskStatusGroup } from '@/types/database';

export function StatusCell({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const config = STATUS_CONFIG[value];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}
          />
        }
      >
        <span className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
        {config.label}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        {(Object.keys(STATUS_GROUPS) as TaskStatusGroup[]).map((group) => (
          <div key={group} className="mb-2 last:mb-0">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
              {STATUS_GROUP_LABELS[group]}
            </p>
            {STATUS_GROUPS[group].map((status) => {
              const sc = STATUS_CONFIG[status];
              return (
                <button
                  key={status}
                  onClick={() => {
                    onChange(status);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted ${
                    status === value ? 'bg-muted' : ''
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${sc.dotColor}`} />
                  {sc.label}
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
