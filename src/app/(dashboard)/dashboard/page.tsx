import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/supabase/server';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { DASHBOARD_TASK_COLUMNS, type DashboardTask } from '@/types/database';

export default async function DashboardPage() {
  const user = await getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('tasks')
    .select(DASHBOARD_TASK_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your bounty earnings and task activity
        </p>
      </div>
      {/* undefined (query error) falls back to the client-side fetch */}
      <DashboardView
        userId={user.id}
        initialTasks={(data as DashboardTask[] | null) ?? undefined}
      />
    </div>
  );
}
