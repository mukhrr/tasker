'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { taskRole } from '@/lib/role';
import { useRoleParam } from '@/hooks/use-role-param';
import {
  RoleCount,
  RoleSwitch,
  ReviewerRoleLabel,
} from '@/components/role-switch';
import { useDashboardData } from '@/components/dashboard-data-provider';
import { useDashboardStats } from '@/hooks/use-dashboard-stats';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from './stat-card';
import { StatusChart } from './status-chart';
import { LastSyncCard } from './last-sync-card';

type DashboardRole = 'all' | 'contributor' | 'reviewer';

// Lazy-load the recharts-based charts so recharts stays out of the initial bundle
const EarningsChart = dynamic(
  () => import('./earnings-chart').then((m) => m.EarningsChart),
  { ssr: false, loading: () => <Skeleton className="h-[360px] rounded-xl" /> }
);
const ActivityChart = dynamic(
  () => import('./activity-chart').then((m) => m.ActivityChart),
  { ssr: false, loading: () => <Skeleton className="h-[360px] rounded-xl" /> }
);

const DASHBOARD_ROLES: readonly DashboardRole[] = [
  'all',
  'contributor',
  'reviewer',
];

export function DashboardView() {
  const {
    tasks: { tasks, loading },
  } = useDashboardData();
  const [role, setRole] = useRoleParam<DashboardRole>(DASHBOARD_ROLES, 'all');
  const roleTasks = useMemo(
    () => (role === 'all' ? tasks : tasks.filter((t) => taskRole(t) === role)),
    [tasks, role]
  );
  const counts = useMemo(() => {
    let reviewer = 0;
    for (const t of tasks) if (taskRole(t) === 'reviewer') reviewer += 1;
    return {
      all: tasks.length,
      contributor: tasks.length - reviewer,
      reviewer,
    };
  }, [tasks]);
  const stats = useDashboardStats(roleTasks);
  const isAll = role === 'all';

  const roleSwitch = (
    <RoleSwitch
      value={role}
      onChange={setRole}
      ariaLabel="Dashboard role"
      options={[
        {
          value: 'all',
          label: (
            <>
              All <RoleCount value={counts.all} />
            </>
          ),
        },
        {
          value: 'contributor',
          label: (
            <>
              Committer <RoleCount value={counts.contributor} />
            </>
          ),
        },
        {
          value: 'reviewer',
          label: <ReviewerRoleLabel count={counts.reviewer} />,
        },
      ]}
    />
  );

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

  const lastMonthLabel = months[months.length - 2]?.month ?? 'last month';
  const lastMonthDelta =
    stats.lastMonthDelta !== 0
      ? {
          text: `${stats.lastMonthDelta > 0 ? '+' : '-'}$${Math.abs(
            stats.lastMonthDelta
          ).toLocaleString()} vs prior month`,
          direction:
            stats.lastMonthDelta > 0 ? ('up' as const) : ('down' as const),
        }
      : undefined;

  const share = (amount: number) =>
    isAll && amount > 0 ? `$${amount.toLocaleString()}` : undefined;

  return (
    <div className="space-y-6">
      {roleSwitch}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Earned"
          value={`$${stats.totalEarned.toLocaleString()}`}
          description={`${stats.completedCount} completed tasks`}
          delta={earningsDelta}
          trend={stats.totalEarned > 0 ? earningsTrend : undefined}
          reviewerShare={share(stats.reviewerEarned)}
        />
        <StatCard
          title="Pending"
          value={`$${stats.pendingAmount.toLocaleString()}`}
          description={`${stats.activeCount} active tasks`}
          reviewerShare={share(stats.reviewerPending)}
        />
        <StatCard title="Active Tasks" value={String(stats.activeCount)} />
        <StatCard
          title="Last Month Earned"
          value={`$${stats.lastMonthEarned.toLocaleString()}`}
          description={`${lastMonthLabel} · ${stats.lastMonthCompletedCount} completed`}
          delta={lastMonthDelta}
          reviewerShare={share(stats.lastMonthReviewerEarned)}
        />
      </div>

      <LastSyncCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <EarningsChart
          data={stats.earningsOverTime}
          split={isAll}
          reviewerOnly={role === 'reviewer'}
        />
        <StatusChart data={stats.tasksByStatusGroup} />
      </div>

      <ActivityChart data={stats.monthlyActivity} />
    </div>
  );
}
