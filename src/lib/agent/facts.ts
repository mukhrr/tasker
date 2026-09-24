import type {
  GitHubComment,
  GitHubPullRequest,
  GitHubReview,
} from '@/types/github';

// Broad: keeps any deploy comment inside the prompt window.
export const DEPLOY_COMMENT_RE = /deployed to (production|staging)|🚀.*deploy/i;
// Narrow: only a production deploy starts Expensify's payment clock.
export const PRODUCTION_DEPLOY_RE = /deployed to production/i;
export const PAYMENT_DELAY_DAYS = 7;

const DAY_MS = 86_400_000;

export interface TaskFacts {
  production_deploy_at: string | null;
  days_since_production_deploy: number | null;
  payment_due_at: string | null;
  payment_overdue_days: number | null;
  pushed_after_changes_requested: boolean | null;
  latest_human_review_state: GitHubReview['state'] | null;
  days_since_merge: number | null;
  days_since_assigned: number | null;
  days_since_last_activity: number | null;
}

export interface TaskFactsInput {
  comments: GitHubComment[];
  pr: GitHubPullRequest | null;
  humanReviews: GitHubReview[];
  assignedDate: string | null;
  issueUpdatedAt: string | null;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  const t = time(iso);
  return t === null ? null : Math.floor((now.getTime() - t) / DAY_MS);
}

function newest<T>(items: T[], at: (item: T) => string | null): T | null {
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const item of items) {
    const t = time(at(item));
    if (t !== null && t >= bestAt) {
      best = item;
      bestAt = t;
    }
  }
  return best;
}

export function computeTaskFacts(input: TaskFactsInput, now: Date): TaskFacts {
  const deploy = newest(
    input.comments.filter((c) => PRODUCTION_DEPLOY_RE.test(c.body)),
    (c) => c.created_at
  );
  const deployAt = time(deploy?.created_at);
  const dueAt =
    deployAt === null ? null : new Date(deployAt + PAYMENT_DELAY_DAYS * DAY_MS);

  const latestReview = newest(input.humanReviews, (r) => r.submitted_at);
  const latestChangesRequested = newest(
    input.humanReviews.filter((r) => r.state === 'CHANGES_REQUESTED'),
    (r) => r.submitted_at
  );

  // updated_at is the closest signal to "pushed" without another API call:
  // it moves on a push, and also on edits the developer made anyway.
  const prUpdated = time(input.pr?.updated_at);
  const requestedAt = time(latestChangesRequested?.submitted_at);

  return {
    production_deploy_at: deploy?.created_at ?? null,
    days_since_production_deploy: daysSince(deploy?.created_at, now),
    payment_due_at: dueAt?.toISOString() ?? null,
    payment_overdue_days:
      dueAt === null
        ? null
        : Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS),
    pushed_after_changes_requested:
      prUpdated === null || requestedAt === null
        ? null
        : prUpdated > requestedAt,
    latest_human_review_state: latestReview?.state ?? null,
    days_since_merge: daysSince(input.pr?.merged_at, now),
    days_since_assigned: daysSince(input.assignedDate, now),
    days_since_last_activity: daysSince(input.issueUpdatedAt, now),
  };
}
