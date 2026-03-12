import { createClient } from '@/lib/supabase/server';
import { TaskList } from '@/components/task-list';
import { CreateTaskButton } from '@/components/create-task-button';
import type { Task } from '@/types/database';

export default async function TasksPage() {
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Manage your open source tasks and contributions
          </p>
        </div>
        <CreateTaskButton />
      </div>

      <div className="mt-8">
        <TaskList tasks={(tasks as Task[]) ?? []} />
      </div>
    </div>
  );
}
