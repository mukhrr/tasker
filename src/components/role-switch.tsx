'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReviewerBadge } from '@/components/task-table/cells/reviewer-badge';
import { cn } from '@/lib/utils';

export interface RoleOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function RoleSwitch<T extends string>({
  value,
  onChange,
  options,
  ariaLabel = 'Role',
}: {
  value: T;
  onChange: (value: T) => void;
  options: RoleOption<T>[];
  ariaLabel?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as T)}
      className="w-full sm:w-fit"
    >
      <TabsList
        aria-label={ariaLabel}
        className={cn(
          'grid h-9 w-full sm:inline-flex sm:w-fit',
          options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
        )}
      >
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value} className="px-3">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function RoleCount({ value }: { value: number }) {
  return (
    <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
  );
}

export function ReviewerRoleLabel({
  count,
  myTurn,
}: {
  count?: number;
  myTurn?: number;
}) {
  return (
    <>
      <ReviewerBadge isReviewer />
      Reviewer
      {count !== undefined && <RoleCount value={count} />}
      {myTurn !== undefined && myTurn > 0 && (
        <span
          aria-label={`${myTurn} need your review`}
          title={`${myTurn} need your review`}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {myTurn}
        </span>
      )}
    </>
  );
}
