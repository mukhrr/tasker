import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TaskDetail } from '@/components/task-detail';
import type { Task } from '@/types/database';

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single();

  if (!task) {
    notFound();
  }

  return <TaskDetail task={task as Task} />;
}
