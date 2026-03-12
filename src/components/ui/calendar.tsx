'use client';

import * as React from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface CalendarProps {
  value?: Date | null;
  onChange?: (date: Date | null) => void;
  /** Return true to disable a given day */
  disableDate?: (date: Date) => boolean;
  className?: string;
}

function Calendar({ value, onChange, disableDate, className }: CalendarProps) {
  const [viewDate, setViewDate] = React.useState(() => value ?? new Date());

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <div data-slot="calendar" className={cn('w-[280px] p-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setViewDate((d) => subMonths(d, 1))}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(viewDate, 'MMMM yyyy')}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setViewDate((d) => addMonths(d, 1))}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {weekdays.map((day) => (
          <div
            key={day}
            className="flex items-center justify-center text-xs font-medium text-muted-foreground h-8 w-full"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = isSameMonth(day, viewDate);
          const selected = value ? isSameDay(day, value) : false;
          const today = isToday(day);
          const disabled = disableDate?.(day) ?? false;

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (selected) {
                  onChange?.(null);
                } else {
                  onChange?.(day);
                }
              }}
              className={cn(
                'relative flex items-center justify-center h-8 w-full rounded-md text-sm transition-colors',
                'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !inMonth && 'text-muted-foreground/40',
                inMonth && !selected && 'text-foreground',
                selected &&
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                today && !selected && 'font-semibold text-primary',
                disabled && 'pointer-events-none opacity-30'
              )}
            >
              {format(day, 'd')}
              {today && !selected && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 size-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { Calendar };
export type { CalendarProps };
