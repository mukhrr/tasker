import type { Task } from '@/types/database';

// The user chose this status by hand: after the last sync, or, on a task
// never synced, any time after it was created (a HOLD set on a new row is
// a judgement the model cannot see). Not updated_at: the trigger stamps it a
// few ms after the sync's own last_synced_at, so every synced row looked edited.
export function userSetStatus(task: Task): boolean {
  if (task.last_synced_at) {
    return new Date(task.status_changed_at) > new Date(task.last_synced_at);
  }
  return (
    new Date(task.status_changed_at).getTime() >
    new Date(task.created_at).getTime() + 60_000
  );
}
