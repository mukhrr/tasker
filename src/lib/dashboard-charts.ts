import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Task, TaskStatusGroup, UserStatus } from '@/types/database';

type ChartTask = Pick<
  Task,
  | 'id'
  | 'status'
  | 'status_group'
  | 'amount'
  | 'payment_date'
  | 'assigned_date'
  | 'is_reviewer'
  | 'archived'
  | 'issue_url'
  | 'issue_number'
  | 'issue_title'
>;

const isReview = (t: Pick<Task, 'is_reviewer'>) => t.is_reviewer === true;
const day = (d: Date) => format(d, 'yyyy-MM-dd');

export interface AssignedDay {
  date: string;
  label: string;
  committer: number;
  reviewer: number;
}

// Counts the window of `days` ending today, plus the same length before it
// for the comparison.
export function assignedPerDay(
  tasks: ChartTask[],
  now: Date,
  days = 10
): {
  days: AssignedDay[];
  total: number;
  reviewer: number;
  previous: number;
} {
  const start = addDays(now, -(2 * days - 1));
  const rows: AssignedDay[] = Array.from({ length: 2 * days }, (_, i) => {
    const d = addDays(start, i);
    return {
      date: day(d),
      label: format(d, 'MMM d'),
      committer: 0,
      reviewer: 0,
    };
  });
  const index = new Map(rows.map((r, i) => [r.date, i]));
  for (const t of tasks) {
    const i = t.assigned_date
      ? index.get(t.assigned_date.slice(0, 10))
      : undefined;
    if (i === undefined) continue;
    if (isReview(t)) rows[i].reviewer += 1;
    else rows[i].committer += 1;
  }
  const count = (list: AssignedDay[]) =>
    list.reduce((s, r) => s + r.committer + r.reviewer, 0);
  const shown = rows.slice(days);
  return {
    days: shown,
    total: count(shown),
    reviewer: shown.reduce((s, r) => s + r.reviewer, 0),
    previous: count(rows.slice(0, days)),
  };
}

export interface PayoutRow {
  id: string;
  issueUrl: string;
  issueNumber: number | null;
  title: string;
  amount: number;
  paymentDate: string | null;
  daysLate: number;
  reviewer: boolean;
}

// Pending-group tasks are the ones whose work is done and only the payment
// is left; a past payment date means the money is waiting on someone.
export function payoutsDue(
  tasks: ChartTask[],
  now: Date
): { overdue: PayoutRow[]; upcoming: PayoutRow[]; total: number } {
  const today = day(now);
  const rows = tasks
    .filter((t) => !t.archived && t.status_group === 'pending')
    .map(
      (t): PayoutRow => ({
        id: t.id,
        issueUrl: t.issue_url,
        issueNumber: t.issue_number,
        title: cleanTitle(t.issue_title) || t.issue_url,
        amount: t.amount ?? 0,
        paymentDate: t.payment_date?.slice(0, 10) ?? null,
        daysLate: t.payment_date
          ? differenceInCalendarDays(now, parseISO(t.payment_date.slice(0, 10)))
          : 0,
        reviewer: isReview(t),
      })
    )
    .sort((a, b) =>
      (a.paymentDate ?? '9999').localeCompare(b.paymentDate ?? '9999')
    );
  return {
    overdue: rows.filter(
      (r) => r.paymentDate !== null && r.paymentDate < today
    ),
    upcoming: rows.filter(
      (r) => r.paymentDate === null || r.paymentDate >= today
    ),
    total: rows.reduce((s, r) => s + r.amount, 0),
  };
}

// Expensify titles carry bracketed tags ("[Due for payment …] [$250]") that
// crowd out the actual subject in a one-line row.
export function cleanTitle(title: string | null): string {
  return (title ?? '').replace(/^(\s*\[[^\]]*\])+\s*/, '').trim();
}

export interface UnpaidRow {
  key: string;
  label: string;
  committer: number;
  reviewer: number;
  count: number;
}

export interface UnpaidGroup {
  group: TaskStatusGroup;
  total: number;
  rows: UnpaidRow[];
}

const UNPAID_ORDER: TaskStatusGroup[] = ['pending', 'in_progress', 'todo'];

export function unpaidByStatus(
  tasks: ChartTask[],
  statuses: Pick<UserStatus, 'key' | 'label' | 'group_name'>[]
): { groups: UnpaidGroup[]; total: number; count: number } {
  const labels = new Map(statuses.map((s) => [s.key, s.label]));
  // A task's stored status_group can lag behind its status's group, which
  // would list one status under two groups.
  const groupOf = new Map(statuses.map((s) => [s.key, s.group_name]));
  const groups = UNPAID_ORDER.map((group) => {
    const byKey = new Map<string, UnpaidRow>();
    for (const t of tasks) {
      if (t.archived || (groupOf.get(t.status) ?? t.status_group) !== group)
        continue;
      const row = byKey.get(t.status) ?? {
        key: t.status,
        label: labels.get(t.status) ?? t.status,
        committer: 0,
        reviewer: 0,
        count: 0,
      };
      if (isReview(t)) row.reviewer += t.amount ?? 0;
      else row.committer += t.amount ?? 0;
      row.count += 1;
      byKey.set(t.status, row);
    }
    const rows = [...byKey.values()].sort(
      (a, b) => b.committer + b.reviewer - (a.committer + a.reviewer)
    );
    return {
      group,
      rows,
      total: rows.reduce((s, r) => s + r.committer + r.reviewer, 0),
    };
  }).filter((g) => g.rows.length > 0);
  return {
    groups,
    total: groups.reduce((s, g) => s + g.total, 0),
    count: groups.reduce(
      (s, g) => s + g.rows.reduce((n, r) => n + r.count, 0),
      0
    ),
  };
}

export const PAYOUT_BUCKETS = [
  { label: '≤7d', max: 7 },
  { label: '8–14', max: 14 },
  { label: '15–21', max: 21 },
  { label: '22–30', max: 30 },
  { label: '31–45', max: 45 },
  { label: '46+', max: Infinity },
] as const;

// Paid tasks only, measured from the assigned date to the payment date.
export function assignedToPaid(tasks: ChartTask[]): {
  buckets: { label: string; count: number }[];
  median: number | null;
  count: number;
} {
  const spans = tasks
    .filter(
      (t) =>
        t.status_group === 'complete' &&
        (t.amount ?? 0) > 0 &&
        t.assigned_date &&
        t.payment_date
    )
    .map((t) =>
      differenceInCalendarDays(
        parseISO(t.payment_date!.slice(0, 10)),
        parseISO(t.assigned_date!.slice(0, 10))
      )
    )
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const buckets = PAYOUT_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const d of spans) {
    buckets[PAYOUT_BUCKETS.findIndex((b) => d <= b.max)].count += 1;
  }
  const mid = spans.length >> 1;
  const median =
    spans.length === 0
      ? null
      : spans.length % 2
        ? spans[mid]
        : Math.round((spans[mid - 1] + spans[mid]) / 2);
  return { buckets, median, count: spans.length };
}
