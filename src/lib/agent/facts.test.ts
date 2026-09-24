import { describe, it, expect } from 'vitest';
import {
  computeTaskFacts,
  PRODUCTION_DEPLOY_RE,
  DEPLOY_COMMENT_RE,
} from './facts';
import type {
  GitHubComment,
  GitHubPullRequest,
  GitHubReview,
} from '@/types/github';

const NOW = new Date('2026-09-23T12:00:00Z');

function comment(body: string, created_at: string): GitHubComment {
  return {
    id: 1,
    user: { login: 'bot', id: 1, avatar_url: '' },
    body,
    created_at,
  };
}

function review(
  state: GitHubReview['state'],
  submitted_at: string
): GitHubReview {
  return {
    id: 1,
    user: { login: 'cplus', id: 2, avatar_url: '' },
    state,
    body: null,
    submitted_at,
  };
}

const pr = (over: Partial<GitHubPullRequest> = {}) =>
  ({
    number: 1,
    title: 't',
    state: 'open',
    html_url: 'u',
    user: { login: 'mukhrr', id: 3, avatar_url: '' },
    merged: false,
    merged_at: null,
    draft: false,
    review_comments: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    closed_at: null,
    body: null,
    head: { sha: 'abc' },
    mergeable: true,
    mergeable_state: 'clean',
    ...over,
  }) as GitHubPullRequest;

const empty = {
  comments: [],
  pr: null,
  humanReviews: [],
  assignedDate: null,
  issueUpdatedAt: null,
};

describe('regexes', () => {
  it('counts only production for the payment clock', () => {
    expect(PRODUCTION_DEPLOY_RE.test('Deployed to production in v1.2.3')).toBe(
      true
    );
    expect(PRODUCTION_DEPLOY_RE.test('Deployed to staging in v1.2.3')).toBe(
      false
    );
    expect(DEPLOY_COMMENT_RE.test('Deployed to staging in v1.2.3')).toBe(true);
  });
});

describe('computeTaskFacts', () => {
  it('returns all-null for an empty task', () => {
    const f = computeTaskFacts(empty, NOW);
    expect(f.production_deploy_at).toBeNull();
    expect(f.days_since_production_deploy).toBeNull();
    expect(f.payment_due_at).toBeNull();
    expect(f.pushed_after_changes_requested).toBeNull();
    expect(f.latest_human_review_state).toBeNull();
  });

  it('dates the payment clock from the newest production deploy comment', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        comments: [
          comment('Deployed to production 🚀', '2026-09-01T00:00:00Z'),
          comment('Deployed to production again', '2026-09-09T12:00:00Z'),
          comment('Deployed to staging', '2026-09-20T00:00:00Z'),
        ],
      },
      NOW
    );
    expect(f.production_deploy_at).toBe('2026-09-09T12:00:00Z');
    expect(f.days_since_production_deploy).toBe(14);
    expect(f.payment_due_at).toBe('2026-09-16T12:00:00.000Z');
    expect(f.payment_overdue_days).toBe(7);
  });

  it('reports a payment not yet due as negative overdue days', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        comments: [comment('Deployed to production', '2026-09-21T12:00:00Z')],
      },
      NOW
    );
    expect(f.days_since_production_deploy).toBe(2);
    expect(f.payment_overdue_days).toBe(-5);
  });

  it('says the developer pushed after changes were requested', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr({ updated_at: '2026-09-22T00:00:00Z' }),
        humanReviews: [review('CHANGES_REQUESTED', '2026-09-21T00:00:00Z')],
      },
      NOW
    );
    expect(f.pushed_after_changes_requested).toBe(true);
    expect(f.latest_human_review_state).toBe('CHANGES_REQUESTED');
  });

  it('says the developer has not pushed since the request', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr({ updated_at: '2026-09-20T00:00:00Z' }),
        humanReviews: [review('CHANGES_REQUESTED', '2026-09-21T00:00:00Z')],
      },
      NOW
    );
    expect(f.pushed_after_changes_requested).toBe(false);
  });

  it('uses the newest review for both facts', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr(),
        humanReviews: [
          review('CHANGES_REQUESTED', '2026-09-10T00:00:00Z'),
          review('APPROVED', '2026-09-19T00:00:00Z'),
        ],
      },
      NOW
    );
    expect(f.latest_human_review_state).toBe('APPROVED');
    expect(f.pushed_after_changes_requested).toBe(true);
  });

  it('counts days since merge and assignment', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr({ merged: true, merged_at: '2026-09-13T12:00:00Z' }),
        assignedDate: '2026-09-03T12:00:00Z',
      },
      NOW
    );
    expect(f.days_since_merge).toBe(10);
    expect(f.days_since_assigned).toBe(20);
  });

  it('ignores unparsable dates instead of returning NaN', () => {
    const f = computeTaskFacts({ ...empty, assignedDate: 'not-a-date' }, NOW);
    expect(f.days_since_assigned).toBeNull();
  });
});
