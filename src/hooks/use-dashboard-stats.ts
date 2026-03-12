import { useMemo } from 'react';
import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { Task, TaskStatusGroup } from '@/types/database';

export interface DashboardStats {
  totalEarned: number;
  pendingAmount: number;
  activeCount: number;
  completedCount: number;
  earningsOverTime: { month: string; amount: number }[];
  tasksByStatusGroup: { name: string; value: number; group: TaskStatusGroup }[];
  monthlyActivity: { month: string; created: number; completed: number }[];
}

export function useDashboardStats(tasks: Task[]): DashboardStats {
  return useMemo(() => {
    const completeTasks = tasks.filter((t) => t.status_group === 'complete');
    const inProgressTasks = tasks.filter(
      (t) => t.status_group === 'in_progress'
    );

    const totalEarned = completeTasks.reduce(
      (sum, t) => sum + (t.amount ?? 0),
      0
    );
    const pendingAmount = inProgressTasks.reduce(
      (sum, t) => sum + (t.amount ?? 0),
      0
    );
    const activeCount = inProgressTasks.length;
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
      if (t.payment_date) {
        const key = format(parseISO(t.payment_date), 'yyyy-MM');
        if (earningsMap.has(key)) {
          earningsMap.set(key, earningsMap.get(key)! + (t.amount ?? 0));
        }
      }
    }

    const earningsOverTime = monthKeys.map((key) => ({
      month: format(parseISO(key + '-01'), 'MMM yyyy'),
      amount: earningsMap.get(key)!,
    }));

    // Tasks by status group
    const groupLabels: Record<TaskStatusGroup, string> = {
      todo: 'To-do',
      in_progress: 'In Progress',
      complete: 'Complete',
    };
    const groupCounts: Record<TaskStatusGroup, number> = {
      todo: 0,
      in_progress: 0,
      complete: 0,
    };
    for (const t of tasks) {
      groupCounts[t.status_group] = (groupCounts[t.status_group] ?? 0) + 1;
    }
    const tasksByStatusGroup = (
      ['todo', 'in_progress', 'complete'] as TaskStatusGroup[]
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

      if (t.status_group === 'complete' && t.payment_date) {
        const compKey = format(parseISO(t.payment_date), 'yyyy-MM');
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
      earningsOverTime,
      tasksByStatusGroup,
      monthlyActivity,
    };
  }, [tasks]);
}
