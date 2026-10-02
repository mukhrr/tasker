import { describe, it, expect } from 'vitest';
import {
  computeTaskFacts,
  paymentStatus,
  holdLifted,
  approvedByReviewer,
  regressionFromLinkedBugs,
  keepPending,
  unansweredReviewerFeedback,
  PRODUCTION_DEPLOY_RE,
  DEPLOY_COMMENT_RE,
  type TaskFacts,
} from './facts';
import type {
  GitHubComment,
  GitHubEvent,
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

describe('paymentStatus', () => {
  const keys = new Set(['merged', 'awaiting_payment']);
  const facts = (production_deploy_at: string | null) =>
    ({ production_deploy_at }) as TaskFacts;
  const deployed = facts('2026-09-25T10:00:00Z');

  it('moves a merged PR deployed to production to awaiting_payment', () => {
    expect(paymentStatus('merged', deployed, keys, 'merged')).toBe(
      'awaiting_payment'
    );
    expect(paymentStatus('awaiting_payment', deployed, keys, 'merged')).toBe(
      'awaiting_payment'
    );
  });

  it('keeps it merged until there is a production deploy', () => {
    expect(paymentStatus('merged', facts(null), keys, 'merged')).toBe('merged');
    expect(
      paymentStatus('awaiting_payment', facts(null), keys, 'reviewing')
    ).toBe('merged');
  });

  it('keeps the current status when the user has no merged status', () => {
    expect(
      paymentStatus(
        'awaiting_payment',
        facts(null),
        new Set(['awaiting_payment']),
        'reviewing'
      )
    ).toBe('reviewing');
  });

  it('leaves other statuses alone', () => {
    expect(paymentStatus('reviewing', deployed, keys, 'merged')).toBe(
      'reviewing'
    );
  });
});

describe('unansweredReviewerFeedback', () => {
  const user = (login: string, type = 'User') =>
    ({ login, type }) as GitHubComment['user'];
  const comment = (login: string, at: string, body = 'x') =>
    ({ user: user(login), body, created_at: at }) as GitHubComment;
  const isBot = (u: GitHubComment['user']) => u.type === 'Bot';
  const base = {
    reviews: [] as GitHubReview[],
    developer: 'mukhrr',
    lastPushAt: '2026-09-22T00:00:00Z',
    isBot,
  };

  it('keeps reviewer comments after the last push', () => {
    const out = unansweredReviewerFeedback({
      ...base,
      comments: [
        comment('brunovjk', '2026-09-25T13:00:00Z', 'race condition?'),
      ],
    });
    expect(out).toEqual([
      {
        user: 'brunovjk',
        body: 'race condition?',
        created_at: '2026-09-25T13:00:00Z',
      },
    ]);
  });

  it('drops feedback the developer already replied to', () => {
    const out = unansweredReviewerFeedback({
      ...base,
      comments: [
        comment('brunovjk', '2026-09-25T13:00:00Z'),
        comment('mukhrr', '2026-09-25T14:00:00Z'),
      ],
    });
    expect(out).toEqual([]);
  });

  it('ignores bots and anything before the push', () => {
    const out = unansweredReviewerFeedback({
      ...base,
      comments: [
        {
          ...comment('codecov', '2026-09-25T13:00:00Z'),
          user: user('codecov', 'Bot'),
        },
        comment('brunovjk', '2026-09-20T13:00:00Z'),
      ],
    });
    expect(out).toEqual([]);
  });

  it('counts a COMMENTED review with a body, not an empty one', () => {
    const review = (body: string | null) =>
      ({
        user: user('dmkt9'),
        state: 'COMMENTED',
        body,
        submitted_at: '2026-09-28T04:12:00Z',
      }) as GitHubReview;
    expect(
      unansweredReviewerFeedback({
        ...base,
        comments: [],
        reviews: [review('please fix reload')],
      })
    ).toHaveLength(1);
    expect(
      unansweredReviewerFeedback({
        ...base,
        comments: [],
        reviews: [review('')],
      })
    ).toHaveLength(0);
  });
});

describe('holdLifted', () => {
  const since = '2026-09-20T00:00:00Z';
  const said = (body: string, created_at = '2026-09-25T00:00:00Z') =>
    ({ body, created_at }) as GitHubComment;
  const renamed = (from: string, to: string) =>
    ({
      event: 'renamed',
      created_at: '2026-09-25T00:00:00Z',
      rename: { from, to },
    }) as GitHubEvent;

  it('needs an explicit comment after the hold was set', () => {
    expect(
      holdLifted({
        since,
        comments: [said('Taking this off hold, the backend PR merged')],
        events: [],
      })
    ).toBe(true);
    expect(
      holdLifted({
        since,
        comments: [said('we are unblocked now')],
        events: [],
      })
    ).toBe(true);
    expect(
      holdLifted({
        since,
        comments: [said('off hold', '2026-09-10T00:00:00Z')],
        events: [],
      })
    ).toBe(false);
  });

  it('is lifted when HOLD leaves the title', () => {
    expect(
      holdLifted({
        since,
        comments: [],
        events: [renamed('[HOLD #123] Fix x', 'Fix x')],
      })
    ).toBe(true);
    expect(
      holdLifted({ since, comments: [], events: [renamed('Fix x', 'Fix y')] })
    ).toBe(false);
  });

  it('is not lifted by ordinary review traffic', () => {
    expect(
      holdLifted({
        since,
        comments: [
          said('Looks good, testing now'),
          said('PR is ready for review'),
        ],
        events: [],
      })
    ).toBe(false);
  });
});

describe('keepPending', () => {
  const groups: Record<string, string> = {
    awaiting_payment: 'pending',
    submit: 'pending',
    merged: 'in_progress',
    reviewing: 'in_progress',
    regression: 'todo',
    changes_required: 'todo',
    paid: 'complete',
  };
  const groupOf = (k: string) => groups[k];

  it('never moves a pending task back to To do or In progress', () => {
    expect(keepPending('awaiting_payment', 'merged', groupOf)).toBe(
      'awaiting_payment'
    );
    expect(keepPending('submit', 'changes_required', groupOf)).toBe('submit');
  });

  it('allows regression, another pending status, or done', () => {
    expect(keepPending('awaiting_payment', 'regression', groupOf)).toBe(
      'regression'
    );
    expect(keepPending('awaiting_payment', 'submit', groupOf)).toBe('submit');
    expect(keepPending('submit', 'paid', groupOf)).toBe('paid');
  });

  it('leaves tasks outside Pending alone', () => {
    expect(keepPending('merged', 'reviewing', groupOf)).toBe('reviewing');
  });
});

describe('approvedByReviewer', () => {
  const review = (login: string, state: GitHubReview['state'], at: string) =>
    ({ user: { login }, state, submitted_at: at }) as GitHubReview;

  it('counts a human approval', () => {
    expect(
      approvedByReviewer(
        [review('garrettmknight', 'APPROVED', '2026-09-28T13:01:00Z')],
        'mukhrr'
      )
    ).toBe(true);
  });

  it('uses the latest decisive review, ignoring later comments', () => {
    expect(
      approvedByReviewer(
        [
          review('Krishna2323', 'APPROVED', '2026-09-20T00:00:00Z'),
          review('Krishna2323', 'CHANGES_REQUESTED', '2026-09-25T00:00:00Z'),
          review('Krishna2323', 'COMMENTED', '2026-09-26T00:00:00Z'),
        ],
        'mukhrr'
      )
    ).toBe(false);
  });

  it('never counts the developer themselves', () => {
    expect(
      approvedByReviewer(
        [review('mukhrr', 'APPROVED', '2026-09-28T00:00:00Z')],
        'mukhrr'
      )
    ).toBe(false);
  });
});

describe('regressionFromLinkedBugs', () => {
  const keys = new Set(['merged', 'regression', 'paid']);
  const done = (k: string) => k === 'paid';
  const facts = (open_linked_bugs: number | null) =>
    ({ open_linked_bugs }) as TaskFacts;

  it('suggests regression while a linked bug is open', () => {
    expect(regressionFromLinkedBugs('merged', facts(1), keys, done)).toBe(
      'regression'
    );
    expect(
      regressionFromLinkedBugs('awaiting_payment', facts(2), keys, done)
    ).toBe('regression');
  });

  it('leaves the status when none is open or unknown', () => {
    expect(regressionFromLinkedBugs('merged', facts(0), keys, done)).toBe(
      'merged'
    );
    expect(regressionFromLinkedBugs('merged', facts(null), keys, done)).toBe(
      'merged'
    );
  });

  it('never reopens a finished task, and needs a regression status', () => {
    expect(regressionFromLinkedBugs('paid', facts(1), keys, done)).toBe('paid');
    expect(
      regressionFromLinkedBugs('merged', facts(1), new Set(['merged']), done)
    ).toBe('merged');
  });
});
