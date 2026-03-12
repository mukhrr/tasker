import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TaskTable } from '@/components/task-table/task-table';

export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your open source tasks and contributions
        </p>
      </div>
      <TaskTable userId={user.id} />
    </div>
  );
}
