import type { StatusRole, Task } from '@/types/database';

export type TaskRole = 'contributor' | 'reviewer';

// An undecided task (null) stays with the committer tasks until the sync
// or the user marks it as a review.
export function taskRole(task: Pick<Task, 'is_reviewer'>): TaskRole {
  return task.is_reviewer === true ? 'reviewer' : 'contributor';
}

export type Turn = 'me' | 'author' | 'merge' | null;

export function whoseTurn(status: string, role: TaskRole): Turn {
  if (role !== 'reviewer') return null;
  if (status === 'assigned' || status === 'review_due') return 'me';
  if (status === 'waiting_on_author') return 'author';
  if (status === 'approved') return 'merge';
  return null;
}

// keep: the task's current status stays listed even when it belongs to the
// other tab, so the trigger never shows a status the menu lacks.
export function statusesForRole<T extends { key: string; role?: StatusRole }>(
  statuses: T[],
  role: TaskRole,
  keep?: string
): T[] {
  return statuses.filter(
    (s) => s.key === keep || !s.role || s.role === 'both' || s.role === role
  );
}
