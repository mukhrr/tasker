import type {
  GitHubComment,
  GitHubEvent,
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
  unanswered_reviewer_feedback: number | null;
  approved_by_reviewer: boolean | null;
  open_linked_bugs: number | null;
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
    unanswered_reviewer_feedback: null,
    approved_by_reviewer: null,
    open_linked_bugs: null,
  };
}

// A production deploy is what makes a merged PR awaiting payment (due 7 days
// later); without one, awaiting_payment would claim money that is not owed.
export function paymentStatus(
  status: string,
  facts: TaskFacts,
  statusKeys: Set<string>,
  currentStatus: string
): string {
  const deployed = facts.production_deploy_at !== null;
  if (status === 'awaiting_payment' && !deployed) {
    return statusKeys.has('merged') ? 'merged' : currentStatus;
  }
  if (status === 'merged' && deployed && statusKeys.has('awaiting_payment')) {
    return 'awaiting_payment';
  }
  return status;
}

export interface ReviewerNote {
  user: string;
  body: string;
  created_at: string;
}

// Expensify's C+ reviewers rarely use "Request changes": they leave a
// COMMENTED review, inline comments or a PR comment. Feedback counts as open
// until the developer pushes or replies after it.
export function unansweredReviewerFeedback(input: {
  comments: GitHubComment[];
  reviews: GitHubReview[];
  developer: string;
  lastPushAt: string;
  isBot: (user: GitHubComment['user']) => boolean;
}): ReviewerNote[] {
  const dev = input.developer.toLowerCase();
  const notes = [
    ...input.comments.map((c) => ({
      user: c.user,
      body: c.body,
      at: c.created_at,
    })),
    ...input.reviews
      .filter((r) => r.body?.trim() && r.submitted_at)
      .map((r) => ({ user: r.user, body: r.body ?? '', at: r.submitted_at })),
  ];
  let cutoff = input.lastPushAt;
  for (const n of notes) {
    if (n.user.login.toLowerCase() === dev && n.at > cutoff) cutoff = n.at;
  }
  return notes
    .filter(
      (n) =>
        n.at > cutoff &&
        n.user.login.toLowerCase() !== dev &&
        !input.isBot(n.user)
    )
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((n) => ({ user: n.user.login, body: n.body, created_at: n.at }));
}

const HOLD_LIFTED_RE =
  /\b(off hold|unhold|un-hold|no longer (on )?hold|remov(e|ed|ing) (the )?hold|taking (this|it) off hold|unblocked|no longer blocked)\b/i;
const HOLD_TITLE_RE = /\bhold\b/i;

// HOLD is set from context the sync often cannot see (Slack, a blocking PR),
// so leaving it needs explicit evidence after it was set, not an open PR.
export function holdLifted(input: {
  since: string;
  comments: GitHubComment[];
  events: GitHubEvent[];
}): boolean {
  return (
    input.comments.some(
      (c) => c.created_at > input.since && HOLD_LIFTED_RE.test(c.body)
    ) ||
    input.events.some(
      (e) =>
        e.event === 'renamed' &&
        e.created_at > input.since &&
        !!e.rename &&
        HOLD_TITLE_RE.test(e.rename.from) &&
        !HOLD_TITLE_RE.test(e.rename.to)
    )
  );
}

// A task in the Pending group (awaiting payment, submitted) has finished its
// work; the only way back into To do / In progress is a regression.
export function keepPending(
  current: string,
  suggested: string,
  groupOf: (key: string) => string | undefined
): string {
  if (groupOf(current) !== 'pending' || suggested === 'regression') {
    return suggested;
  }
  const to = groupOf(suggested);
  return to === 'todo' || to === 'in_progress' ? current : suggested;
}

// Any human reviewer other than the developer whose latest decisive review
// is APPROVED; a later COMMENTED review does not undo it.
export function approvedByReviewer(
  reviews: GitHubReview[],
  developer: string
): boolean {
  const dev = developer.toLowerCase();
  const latest = new Map<string, GitHubReview>();
  for (const r of reviews) {
    const who = r.user.login.toLowerCase();
    if (who === dev || r.state === 'COMMENTED') continue;
    const prev = latest.get(who);
    if (!prev || r.submitted_at > prev.submitted_at) latest.set(who, r);
  }
  return [...latest.values()].some((r) => r.state === 'APPROVED');
}

// An open bug QA filed against the merged PR outranks every in-flight status;
// a finished one (paid, wasted) stays finished.
export function regressionFromLinkedBugs(
  status: string,
  facts: TaskFacts,
  statusKeys: Set<string>,
  isComplete: (key: string) => boolean
): string {
  if (!facts.open_linked_bugs || !statusKeys.has('regression')) return status;
  return isComplete(status) ? status : 'regression';
}
