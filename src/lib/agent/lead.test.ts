import { describe, it, expect } from 'vitest';
import {
  crossReferencedIssues,
  mentionedIssueNumbers,
  leadUpdate,
  parseLeadResult,
  linkedBugsAfterMerge,
  blamesPr,
  type LeadCandidate,
} from './lead';
import { parsePrCommentUrl, parseIssueUrl } from '@/lib/github';
import type { UserStatus } from '@/types/database';
import type { GitHubComment } from '@/types/github';

const statuses = ['promising', 'wasted'].map(
  (key) => ({ key }) as unknown as UserStatus
);

describe('parsePrCommentUrl', () => {
  it('reads a conversation comment link', () => {
    expect(
      parsePrCommentUrl(
        'https://github.com/Expensify/App/pull/99665#issuecomment-5632552628'
      )
    ).toEqual({
      owner: 'Expensify',
      repo: 'App',
      number: 99665,
      commentId: 5632552628,
      kind: 'issue',
    });
  });

  it('reads a review comment link from the files tab', () => {
    expect(
      parsePrCommentUrl(
        'https://github.com/Expensify/App/pull/99717/files#discussion_r123'
      )
    ).toMatchObject({ number: 99717, commentId: 123, kind: 'review' });
  });

  it('ignores a plain PR link and an issue comment link', () => {
    expect(
      parsePrCommentUrl('https://github.com/Expensify/App/pull/1')
    ).toBeNull();
    expect(
      parsePrCommentUrl(
        'https://github.com/Expensify/App/issues/1#issuecomment-2'
      )
    ).toBeNull();
  });

  it('is not an issue URL, so it never reaches the normal sync path', () => {
    expect(
      parseIssueUrl('https://github.com/Expensify/App/pull/1#issuecomment-2')
    ).toBeNull();
  });
});

const xref = (over: Record<string, unknown>) => ({
  event: 'cross-referenced',
  created_at: '2026-09-20T00:00:00Z',
  source: {
    issue: {
      number: 101,
      html_url: 'https://github.com/Expensify/App/issues/101',
      title: 'Rate not valid on cold cache',
      state: 'open',
      created_at: '2026-09-20T00:00:00Z',
      assignees: [{ login: 'mukhrr' }],
      ...over,
    },
  },
});

describe('crossReferencedIssues', () => {
  it('keeps issues that link back after the lead', () => {
    const out = crossReferencedIssues([xref({})], '2026-09-11T00:00:00Z');
    expect(out).toEqual([
      {
        url: 'https://github.com/Expensify/App/issues/101',
        number: 101,
        title: 'Rate not valid on cold cache',
        state: 'open',
        assignees: ['mukhrr'],
        created_at: '2026-09-20T00:00:00Z',
      },
    ]);
  });

  it('drops PRs, deploy checklists and anything before the lead', () => {
    const out = crossReferencedIssues(
      [
        xref({ pull_request: {} }),
        xref({ title: 'Deploy Checklist: New Expensify 2026-09-09' }),
        { ...xref({}), created_at: '2026-09-01T00:00:00Z' },
      ],
      '2026-09-11T00:00:00Z'
    );
    expect(out).toEqual([]);
  });
});

describe('mentionedIssueNumbers', () => {
  const reply = (body: string) => ({ body }) as GitHubComment;

  it('finds same-repo issue links, once each, minus the excluded', () => {
    expect(
      mentionedIssueNumbers(
        [
          reply(
            'Likely duplicate: https://github.com/Expensify/App/issues/98426'
          ),
          reply(
            'see https://github.com/expensify/app/issues/98426 and https://github.com/Expensify/App/issues/7'
          ),
          reply('https://github.com/Other/Repo/issues/5'),
        ],
        'Expensify',
        'App',
        [7]
      )
    ).toEqual([98426]);
  });
});

describe('leadUpdate', () => {
  const candidates: LeadCandidate[] = [
    {
      url: 'https://github.com/Expensify/App/issues/101',
      number: 101,
      title: 't',
      state: 'open',
      assignees: [],
      created_at: '2026-09-20T00:00:00Z',
    },
  ];
  const result = (over: object) => ({
    outcome: 'pending' as const,
    newIssueUrl: null,
    confidence: 0.9,
    summary: 's',
    ...over,
  });

  it('marks a dead lead wasted', () => {
    for (const outcome of ['fixed_in_pr', 'duplicate', 'declined'] as const) {
      expect(
        leadUpdate(result({ outcome }), [], 'promising', statuses)
          .suggestedStatus
      ).toBe('wasted');
    }
  });

  it('keeps the status when the user has no wasted status', () => {
    expect(
      leadUpdate(result({ outcome: 'declined' }), [], 'promising', [])
        .suggestedStatus
    ).toBe('promising');
  });

  it('keeps a pending lead as it is', () => {
    const u = leadUpdate(result({}), [], 'promising', statuses);
    expect(u.suggestedStatus).toBe('promising');
    expect(u.issue_url).toBeUndefined();
  });

  it('relinks to a new issue only when it is a known candidate', () => {
    const url = 'https://github.com/Expensify/App/issues/101';
    expect(
      leadUpdate(
        result({ outcome: 'new_issue', newIssueUrl: url }),
        candidates,
        'promising',
        statuses
      ).issue_url
    ).toBe(url);
    expect(
      leadUpdate(
        result({
          outcome: 'new_issue',
          newIssueUrl: 'https://github.com/Expensify/App/issues/999',
        }),
        candidates,
        'promising',
        statuses
      ).issue_url
    ).toBeUndefined();
  });

  it('does not relink on low confidence', () => {
    expect(
      leadUpdate(
        result({
          outcome: 'new_issue',
          newIssueUrl: candidates[0].url,
          confidence: 0.6,
        }),
        candidates,
        'promising',
        statuses
      ).issue_url
    ).toBeUndefined();
  });
});

describe('parseLeadResult', () => {
  it('reads fenced JSON', () => {
    expect(
      parseLeadResult(
        '```json\n{"outcome":"duplicate","newIssueUrl":null,"confidence":0.9,"summary":"dup of #98426"}\n```'
      )
    ).toEqual({
      outcome: 'duplicate',
      newIssueUrl: null,
      confidence: 0.9,
      summary: 'dup of #98426',
    });
  });

  it('rejects an unknown outcome', () => {
    expect(
      parseLeadResult('{"outcome":"maybe","confidence":0.9,"summary":""}')
    ).toBeNull();
  });
});

describe('linkedBugsAfterMerge', () => {
  const merged = '2026-05-15T17:25:16Z';
  const ev = (number: number, created: string, title = 'Bug') => ({
    event: 'cross-referenced',
    created_at: created,
    source: {
      issue: {
        number,
        html_url: `https://github.com/Expensify/App/issues/${number}`,
        title,
        state: 'open',
        created_at: created,
        assignees: [],
      },
    },
  });

  it('keeps bugs opened after the merge', () => {
    expect(
      linkedBugsAfterMerge(
        [ev(90854, '2026-05-16T00:00:00Z')],
        merged,
        83782
      ).map((b) => b.number)
    ).toEqual([90854]);
  });

  it('drops the own issue, older issues and deploy checklists', () => {
    expect(
      linkedBugsAfterMerge(
        [
          ev(83782, '2026-05-16T00:00:00Z'),
          ev(90795, '2026-05-16T00:00:00Z', 'Deploy Checklist: New Expensify'),
          {
            ...ev(84139, '2026-03-01T00:00:00Z'),
            created_at: '2026-05-16T00:00:00Z',
          },
        ],
        merged,
        83782
      )
    ).toEqual([]);
  });
});

describe('blamesPr', () => {
  const melvin =
    '**Classification**: Frontend bug **Causing PR**: [#99385](https://github.com/Expensify/App/pull/99385) - "Keep a file attachment intact" by @mukhrr';
  const qaField =
    '**If this was caught during regression testing, add the test name, ID and link from BrowserStack:** https://github.com/Expensify/App/pull/99385';

  it("reads MelvinBot's causing PR and QA's regression field", () => {
    expect(blamesPr([melvin], 99385)).toBe(true);
    expect(blamesPr([qaField], 99385)).toBe(true);
  });

  it('does not blame a PR the bug only mentions (#101693 vs #100012)', () => {
    expect(
      blamesPr([melvin, qaField, 'related: Expensify/App#100012'], 100012)
    ).toBe(false);
  });

  it('does not blame the PR named as a fix (#100874 vs #100780)', () => {
    expect(
      blamesPr(
        [
          'tracked separately from Expensify/App#100765, which has a different root cause and is being fixed in Expensify/App#100780.',
          '- Expensify/App#100765: original deploy blocker, different root cause, fixed by Expensify/App#100780',
        ],
        100780
      )
    ).toBe(false);
  });

  it('reads plain attributions', () => {
    expect(blamesPr(['This was caused by #1234'], 1234)).toBe(true);
    expect(
      blamesPr(
        ['Regression from https://github.com/Expensify/App/pull/1234'],
        1234
      )
    ).toBe(true);
    expect(blamesPr(['introduced in Expensify/App#1234'], 1234)).toBe(true);
    expect(blamesPr(['caused by #12345'], 1234)).toBe(false);
  });
});
