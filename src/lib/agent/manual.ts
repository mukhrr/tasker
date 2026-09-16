import type { Task } from '@/types/database';

// The user chose this status by hand: after the last sync, or, on a task
// never synced, any time after it was created (a HOLD set on a new row is
// a judgement the model cannot see).
export function userSetStatus(task: Task): boolean {
  if (task.last_synced_at) {
    return new Date(task.updated_at) > new Date(task.last_synced_at);
  }
  return (
    new Date(task.status_changed_at).getTime() >
    new Date(task.created_at).getTime() + 60_000
  );
}
