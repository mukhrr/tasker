import Link from 'next/link';
import { Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PayoutRow, payoutsDue } from '@/lib/dashboard-charts';
import { COMMITTER_COLOR, REVIEWER_COLOR } from './chart-colors';

const money = (n: number) => `$${n.toLocaleString()}`;
const sum = (rows: PayoutRow[]) => rows.reduce((s, r) => s + r.amount, 0);

function Row({
  row,
  note,
  late,
}: {
  row: PayoutRow;
  note: string;
  late?: boolean;
}) {
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)_auto_52px] items-center gap-3 text-[13px]">
      <Link
        href={`/tasks/${row.id}`}
        className="font-mono text-xs text-sky-400 hover:text-sky-300"
      >
        {row.issueNumber ? `#${row.issueNumber}` : 'Open'}
      </Link>
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-sm"
          style={{
            background: row.reviewer ? REVIEWER_COLOR : COMMITTER_COLOR,
          }}
        />
        <span className="truncate">{row.title}</span>
        {row.reviewer && <span className="sr-only">(reviewer)</span>}
      </span>
      <span
        className={`whitespace-nowrap text-xs ${
          late ? 'text-amber-400' : 'text-muted-foreground'
        }`}
      >
        {note}
      </span>
      <span className="text-right font-mono tabular-nums">
        {money(row.amount)}
      </span>
    </li>
  );
}

export function PayoutsCard({ data }: { data: ReturnType<typeof payoutsDue> }) {
  const { overdue, upcoming, total } = data;
  const count = overdue.length + upcoming.length;

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Payouts due</CardTitle>
          <CardDescription>
            {count > 0
              ? `${money(total)} across ${count} ${count === 1 ? 'task' : 'tasks'}`
              : 'Nothing waiting on a payout'}
          </CardDescription>
        </div>
        {count > 0 && (
          <span className="font-mono text-2xl font-medium tabular-nums">
            {money(total)}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {overdue.length > 0 && (
          <div className="space-y-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
            <div className="flex items-center justify-between gap-3 text-sm font-semibold text-amber-200">
              <span className="flex items-center gap-2">
                <Clock aria-hidden="true" className="size-4 text-amber-400" />
                Past due
              </span>
              <span className="font-mono">
                {money(sum(overdue))} · {overdue.length}
              </span>
            </div>
            <ul className="space-y-2">
              {overdue.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  late
                  note={`${r.daysLate} ${r.daysLate === 1 ? 'day' : 'days'} late`}
                />
              ))}
            </ul>
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="space-y-2.5 px-3.5">
            <div className="flex justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Coming up</span>
              <span>
                {money(sum(upcoming))} · {upcoming.length}
              </span>
            </div>
            <ul className="space-y-2">
              {upcoming.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  note={
                    r.paymentDate
                      ? format(parseISO(r.paymentDate), 'EEE, MMM d')
                      : 'No date yet'
                  }
                />
              ))}
            </ul>
          </div>
        )}
        {count === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Tasks in a pending status show up here with their payment date
          </p>
        )}
      </CardContent>
    </Card>
  );
}
