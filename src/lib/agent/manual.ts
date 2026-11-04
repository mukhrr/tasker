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

// The sync only fills an empty date. payment_due_at is recomputed from the
// deploy comment on every run, so writing it back would undo a date the user moved.
export function paymentDateToWrite(
  task: Pick<Task, 'payment_date'>,
  suggested: string | null | undefined
): string | null {
  return task.payment_date ? null : (suggested ?? null);
}
