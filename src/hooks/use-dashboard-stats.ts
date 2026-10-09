import { useMemo } from 'react';
import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { Task, TaskStatusGroup } from '@/types/database';

export interface DashboardStats {
  totalEarned: number;
  pendingAmount: number;
  activeCount: number;
  completedCount: number;
  /** Amount earned in the previous calendar month */
  lastMonthEarned: number;
  /** Tasks completed in the previous calendar month */
  lastMonthCompletedCount: number;
  /** Signed change vs the month before last */
  lastMonthDelta: number;
  earningsOverTime: { month: string; amount: number }[];
  tasksByStatusGroup: { name: string; value: number; group: TaskStatusGroup }[];
  monthlyActivity: { month: string; created: number; completed: number }[];
}

type StatsTask = Pick<
  Task,
  | 'status_group'
  | 'amount'
  | 'payment_date'
  | 'status_changed_at'
  | 'created_at'
>;

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
  return useMemo(() => {
    const completeTasks = tasks.filter((t) => t.status_group === 'complete');
    const inProgressTasks = tasks.filter(
      (t) => t.status_group === 'in_progress'
    );
    const pendingTasks = tasks.filter((t) => t.status_group === 'pending');
    const activeTasks = [...inProgressTasks, ...pendingTasks];

    const totalEarned = completeTasks.reduce(
      (sum, t) => sum + (t.amount ?? 0),
      0
    );
    const pendingAmount = activeTasks.reduce(
      (sum, t) => sum + (t.amount ?? 0),
      0
    );
    const activeCount = activeTasks.length;
    const completedCount = completeTasks.length;

    // Earnings over time — last 12 months
    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      monthKeys.push(format(startOfMonth(subMonths(now, i)), 'yyyy-MM'));
    }

    const earningsMap = new Map<string, number>();
    for (const key of monthKeys) earningsMap.set(key, 0);

    for (const t of completeTasks) {
      const key = paidMonth(t);
      if (earningsMap.has(key)) {
        earningsMap.set(key, earningsMap.get(key)! + (t.amount ?? 0));
      }
    }

    const earningsOverTime = monthKeys.map((key) => ({
      month: format(parseISO(key + '-01'), 'MMM yyyy'),
      amount: earningsMap.get(key)!,
    }));

    // Previous calendar month — earnings, tasks completed, and change vs the
    // month before it
    const lastMonthKey = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM');
    const prevMonthKey = format(startOfMonth(subMonths(now, 2)), 'yyyy-MM');
    const lastMonthEarned = earningsMap.get(lastMonthKey) ?? 0;
    const lastMonthDelta =
      lastMonthEarned - (earningsMap.get(prevMonthKey) ?? 0);
    const lastMonthCompletedCount = completeTasks.filter(
      (t) => paidMonth(t) === lastMonthKey
    ).length;

    // Tasks by status group
    const groupLabels: Record<TaskStatusGroup, string> = {
      todo: 'To-do',
      in_progress: 'In Progress',
      pending: 'Pending',
      complete: 'Complete',
    };
    const groupCounts: Record<TaskStatusGroup, number> = {
      todo: 0,
      in_progress: 0,
      pending: 0,
      complete: 0,
    };
    for (const t of tasks) {
      groupCounts[t.status_group] = (groupCounts[t.status_group] ?? 0) + 1;
    }
    const tasksByStatusGroup = (
      ['todo', 'in_progress', 'pending', 'complete'] as TaskStatusGroup[]
    ).map((g) => ({
      name: groupLabels[g],
      value: groupCounts[g],
      group: g,
    }));

    // Monthly activity — last 6 months
    const activityKeys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      activityKeys.push(format(startOfMonth(subMonths(now, i)), 'yyyy-MM'));
    }

    const createdMap = new Map<string, number>();
    const completedMap = new Map<string, number>();
    for (const key of activityKeys) {
      createdMap.set(key, 0);
      completedMap.set(key, 0);
    }

    for (const t of tasks) {
      const createdKey = format(parseISO(t.created_at), 'yyyy-MM');
      if (createdMap.has(createdKey)) {
        createdMap.set(createdKey, createdMap.get(createdKey)! + 1);
      }

      if (t.status_group === 'complete') {
        const compKey = paidMonth(t);
        if (completedMap.has(compKey)) {
          completedMap.set(compKey, completedMap.get(compKey)! + 1);
        }
      }
    }

    const monthlyActivity = activityKeys.map((key) => ({
      month: format(parseISO(key + '-01'), 'MMM'),
      created: createdMap.get(key)!,
      completed: completedMap.get(key)!,
    }));

    return {
      totalEarned,
      pendingAmount,
      activeCount,
      completedCount,
      lastMonthEarned,
      lastMonthCompletedCount,
      lastMonthDelta,
      earningsOverTime,
      tasksByStatusGroup,
      monthlyActivity,
    };
  }, [tasks]);
}
