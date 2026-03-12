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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Earned"
          value={`$${stats.totalEarned.toLocaleString()}`}
          description={`${stats.completedCount} completed tasks`}
          accent="var(--chart-2)"
        />
        <StatCard
          title="Pending"
          value={`$${stats.pendingAmount.toLocaleString()}`}
          description={`${stats.activeCount} active tasks`}
          accent="var(--chart-1)"
        />
        <StatCard
          title="Active Tasks"
          value={String(stats.activeCount)}
          accent="var(--chart-4)"
        />
        <StatCard
          title="Completed"
          value={String(stats.completedCount)}
          description={`of ${tasks.length} total`}
          accent="var(--chart-3)"
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
