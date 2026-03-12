'use client';

import { startOfDay } from 'date-fns';
import { DatePicker } from '@/components/ui/date-picker';

export function DateCell({
  value,
  onChange,
  mode = 'future',
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** "past" disables future dates (for payment), "future" disables past dates */
  mode?: 'past' | 'future';
}) {
  const dateValue = value ? new Date(value + 'T00:00:00') : null;

  const today = startOfDay(new Date());
  const disableDate =
    mode === 'past'
      ? (d: Date) => d < today
      : (d: Date) => d > today;

  return (
    <DatePicker
      value={dateValue}
      onChange={(date) => {
        if (date) {
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          onChange(`${yyyy}-${mm}-${dd}`);
        } else {
          onChange(null);
        }
      }}
      disableDate={disableDate}
      placeholder="—"
      displayFormat="MMM d, yyyy"
      className="h-8 border-none shadow-none bg-transparent hover:bg-muted px-2 text-sm"
    />
  );
}
