import { useMemo } from 'react';
import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { Task } from '@/types/database';

export interface DashboardStats {
  totalEarned: number;
  pendingAmount: number;
  /** The share of totalEarned, pendingAmount and lastMonthEarned that came
   * from tasks reviewed as C+; already included in those totals */
  reviewerEarned: number;
  reviewerPending: number;
  lastMonthReviewerEarned: number;
  activeCount: number;
  completedCount: number;
  /** Amount earned in the previous calendar month */
  lastMonthEarned: number;
  /** Tasks completed in the previous calendar month */
  lastMonthCompletedCount: number;
  /** Signed change vs the month before last */
  lastMonthDelta: number;
  earningsOverTime: { month: string; amount: number; reviewer: number }[];
}

type StatsTask = Pick<
  Task,
  | 'status_group'
  | 'amount'
  | 'payment_date'
  | 'status_changed_at'
  | 'created_at'
  | 'is_reviewer'
>;

const sumAmount = (tasks: StatsTask[]) =>
  tasks.reduce((sum, t) => sum + (t.amount ?? 0), 0);
const reviews = (tasks: StatsTask[]) =>
  tasks.filter((t) => t.is_reviewer === true);

// A task counts as earned when it was moved to complete. A row created already
// complete (an import) has no such move, so its payment_date is used instead.
export function paidMonth(
  t: Pick<Task, 'payment_date' | 'status_changed_at' | 'created_at'>
): string {
  const changed = parseISO(t.status_changed_at);
  const created = parseISO(t.created_at);
  const createdComplete = changed.getTime() - created.getTime() < 60_000;
  if (createdComplete) {
    return t.payment_date?.slice(0, 7) ?? format(created, 'yyyy-MM');
  }
  return format(changed, 'yyyy-MM');
}

// Accepts any row shape carrying the stats fields (full Task or DashboardTask)
export function useDashboardStats(tasks: StatsTask[]): DashboardStats {
  return useMemo(() => computeDashboardStats(tasks, new Date()), [tasks]);
}

export function computeDashboardStats(
  tasks: StatsTask[],
  now: Date
): DashboardStats {
  const completeTasks = tasks.filter((t) => t.status_group === 'complete');
  const inProgressTasks = tasks.filter((t) => t.status_group === 'in_progress');
  const pendingTasks = tasks.filter((t) => t.status_group === 'pending');
  const activeTasks = [...inProgressTasks, ...pendingTasks];

  const totalEarned = sumAmount(completeTasks);
  const pendingAmount = sumAmount(activeTasks);
  const reviewerEarned = sumAmount(reviews(completeTasks));
  const reviewerPending = sumAmount(reviews(activeTasks));
  const activeCount = activeTasks.length;
  const completedCount = completeTasks.length;

  // Earnings over time — last 12 months
  const monthKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    monthKeys.push(format(startOfMonth(subMonths(now, i)), 'yyyy-MM'));
  }

  const earningsMap = new Map<string, number>();
  const reviewerMap = new Map<string, number>();
  for (const key of monthKeys) {
    earningsMap.set(key, 0);
    reviewerMap.set(key, 0);
  }

  for (const t of completeTasks) {
    const key = paidMonth(t);
    if (earningsMap.has(key)) {
      earningsMap.set(key, earningsMap.get(key)! + (t.amount ?? 0));
      if (t.is_reviewer === true) {
        reviewerMap.set(key, reviewerMap.get(key)! + (t.amount ?? 0));
      }
    }
  }

  const earningsOverTime = monthKeys.map((key) => ({
    month: format(parseISO(key + '-01'), 'MMM yyyy'),
    amount: earningsMap.get(key)!,
    reviewer: reviewerMap.get(key)!,
  }));

  // Previous calendar month — earnings, tasks completed, and change vs the
  // month before it
  const lastMonthKey = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM');
  const prevMonthKey = format(startOfMonth(subMonths(now, 2)), 'yyyy-MM');
  const lastMonthEarned = earningsMap.get(lastMonthKey) ?? 0;
  const lastMonthReviewerEarned = reviewerMap.get(lastMonthKey) ?? 0;
  const lastMonthDelta = lastMonthEarned - (earningsMap.get(prevMonthKey) ?? 0);
  const lastMonthCompletedCount = completeTasks.filter(
    (t) => paidMonth(t) === lastMonthKey
  ).length;

  return {
    totalEarned,
    pendingAmount,
    reviewerEarned,
    reviewerPending,
    lastMonthReviewerEarned,
    activeCount,
    completedCount,
    lastMonthEarned,
    lastMonthCompletedCount,
    lastMonthDelta,
    earningsOverTime,
  };
}
