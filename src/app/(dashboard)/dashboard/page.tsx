import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { DashboardView } from '@/components/dashboard/dashboard-view';

export default async function DashboardPage() {
  const user = await getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your bounty earnings and task activity
        </p>
      </div>
      <DashboardView userId={user.id} />
    </div>
  );
}
