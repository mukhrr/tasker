'use client';

import Link from 'next/link';
import type { Task, TaskStatus, TaskPriority } from '@/types/database';

const statusColors: Record<TaskStatus, string> = {
  open: 'bg-blue-500/10 text-blue-500',
  in_progress: 'bg-yellow-500/10 text-yellow-500',
  in_review: 'bg-purple-500/10 text-purple-500',
  completed: 'bg-green-500/10 text-green-500',
};

const statusLabels: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  completed: 'Completed',
};

const priorityColors: Record<TaskPriority, string> = {
  low: 'bg-gray-500/10 text-gray-500',
  medium: 'bg-blue-500/10 text-blue-500',
  high: 'bg-orange-500/10 text-orange-500',
  urgent: 'bg-red-500/10 text-red-500',
};

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-foreground/10 p-12 text-center">
        <p className="text-foreground/40">No tasks yet. Create your first task to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <Link
          key={task.id}
          href={`/tasks/${task.id}`}
          className="flex items-center justify-between rounded-lg border border-foreground/10 p-4 transition-colors hover:bg-foreground/[0.02]"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h3 className="truncate font-medium">{task.title}</h3>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[task.status]}`}
              >
                {statusLabels[task.status]}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priorityColors[task.priority]}`}
              >
                {task.priority}
              </span>
            </div>
            {task.description && (
              <p className="mt-1 truncate text-sm text-foreground/60">
                {task.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-4 text-xs text-foreground/40">
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
