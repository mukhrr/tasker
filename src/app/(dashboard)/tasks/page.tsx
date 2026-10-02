import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { TaskTable } from '@/components/task-table/task-table';

export default async function TasksPage() {
  const user = await getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold sm:text-2xl">Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your open source tasks and contributions
        </p>
      </div>
      <TaskTable userId={user.id} />
    </div>
  );
}
