import type { UserStatus } from './types';

// Mirrors src/lib/role.ts in the web app; keep the two in step.
export type Turn = 'me' | 'author' | 'merge' | null;

export function whoseTurn(status: string, isReviewer: boolean): Turn {
  if (!isReviewer) return null;
  if (status === 'assigned' || status === 'review_due') return 'me';
  if (status === 'waiting_on_author') return 'author';
  if (status === 'approved') return 'merge';
  return null;
}

// keep: the task's current status stays listed even when it belongs to the other tab.
export function statusesForTab(statuses: UserStatus[], isReviewer: boolean, keep?: string): UserStatus[] {
  const tab = isReviewer ? 'reviewer' : 'contributor';
  return statuses.filter(s => s.key === keep || !s.role || s.role === 'both' || s.role === tab);
}
