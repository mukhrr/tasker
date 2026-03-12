'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { Task, TaskStatus, TaskPriority } from '@/types/database';

const statusVariant: Record<TaskStatus, 'default' | 'secondary' | 'outline'> = {
  open: 'default',
  in_progress: 'secondary',
  in_review: 'outline',
  completed: 'default',
};

const statusLabels: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  completed: 'Completed',
};

const priorityVariant: Record<TaskPriority, 'default' | 'secondary' | 'outline'> = {
  low: 'outline',
  medium: 'secondary',
  high: 'default',
  urgent: 'default',
};

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border p-12 text-center">
        <p className="text-muted-foreground">
          No tasks yet. Create your first task to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <Link
          key={task.id}
          href={`/tasks/${task.id}`}
          className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h3 className="truncate font-medium">{task.title}</h3>
              <Badge variant={statusVariant[task.status]}>
                {statusLabels[task.status]}
              </Badge>
              <Badge variant={priorityVariant[task.priority]}>
                {task.priority}
              </Badge>
            </div>
            {task.description && (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {task.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              {task.repository_url && (
                <span className="truncate">{task.repository_url}</span>
              )}
              <span>{new Date(task.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
