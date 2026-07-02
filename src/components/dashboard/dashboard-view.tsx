'use client';

import { useTasks } from '@/hooks/use-tasks';
import { useDashboardStats } from '@/hooks/use-dashboard-stats';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from './stat-card';
import { EarningsChart } from './earnings-chart';
import { StatusChart } from './status-chart';
import { ActivityChart } from './activity-chart';

export function DashboardView({ userId }: { userId: string }) {
  const { tasks, loading } = useTasks(userId);
  const stats = useDashboardStats(tasks);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[360px] rounded-xl" />
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
        <Skeleton className="h-[360px] rounded-xl" />
      </div>
    );
  }

  const months = stats.earningsOverTime;
  const thisMonth = months[months.length - 1]?.amount ?? 0;
  const lastMonth = months[months.length - 2]?.amount ?? 0;
  const diff = thisMonth - lastMonth;
  const earningsDelta =
    diff !== 0
      ? {
          text: `${diff > 0 ? '+' : '-'}$${Math.abs(diff).toLocaleString()} vs last month`,
          direction: diff > 0 ? ('up' as const) : ('down' as const),
        }
      : undefined;
  const earningsTrend = months.map((m) => m.amount);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Earned"
          value={`$${stats.totalEarned.toLocaleString()}`}
          description={`${stats.completedCount} completed tasks`}
          delta={earningsDelta}
          trend={stats.totalEarned > 0 ? earningsTrend : undefined}
        />
        <StatCard
          title="Pending"
          value={`$${stats.pendingAmount.toLocaleString()}`}
          description={`${stats.activeCount} active tasks`}
        />
        <StatCard title="Active Tasks" value={String(stats.activeCount)} />
        <StatCard
          title="Completed"
          value={String(stats.completedCount)}
          description={`of ${tasks.length} total`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EarningsChart data={stats.earningsOverTime} />
        <StatusChart data={stats.tasksByStatusGroup} />
      </div>

      <ActivityChart data={stats.monthlyActivity} />
    </div>
  );
}
