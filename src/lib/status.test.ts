import { describe, expect, it } from 'vitest';
import type { UserStatus } from '@/types/database';
import {
  getAttentionScore,
  getStaleRowBg,
  getStatusTotals,
  isPaymentOverdue,
  getReviewerTotal,
} from './status';

const now = new Date(2026, 10, 2, 15, 0);

describe('isPaymentOverdue', () => {
  it('flags an unpaid task whose payment date is before today', () => {
    expect(isPaymentOverdue('2026-10-27', 'pending', now)).toBe(true);
  });

  it('does not flag a payment due today or later', () => {
    expect(isPaymentOverdue('2026-11-02', 'pending', now)).toBe(false);
    expect(isPaymentOverdue('2026-11-05', 'pending', now)).toBe(false);
  });

  it('ignores completed tasks and missing dates', () => {
    expect(isPaymentOverdue('2026-10-27', 'complete', now)).toBe(false);
    expect(isPaymentOverdue(null, 'pending', now)).toBe(false);
  });
});

describe('getStatusTotals', () => {
  const status = (
    key: string,
    group_name: UserStatus['group_name'],
    position: number
  ) =>
    ({
      key,
      label: key.toUpperCase(),
      color: 'blue',
      group_name,
      position,
    }) as UserStatus;

  const statuses = [
    status('paid', 'complete', 0),
    status('review', 'pending', 1),
    status('awaiting', 'pending', 0),
    status('wip', 'in_progress', 0),
  ];

  it('sums per status in group and position order', () => {
    const totals = getStatusTotals(
      [
        { status: 'paid', amount: 250 },
        { status: 'review', amount: 100 },
        { status: 'awaiting', amount: 500 },
        { status: 'paid', amount: 750 },
      ],
      statuses
    );
    expect(totals.map((t) => [t.key, t.amount])).toEqual([
      ['awaiting', 500],
      ['review', 100],
      ['paid', 1000],
    ]);
  });

  it('skips statuses with no amount', () => {
    const totals = getStatusTotals(
      [
        { status: 'wip', amount: null },
        { status: 'paid', amount: 0 },
        { status: 'review', amount: 100 },
      ],
      statuses
    );
    expect(totals.map((t) => t.key)).toEqual(['review']);
  });

  it('keeps a status missing from the taxonomy so the parts add up', () => {
    const totals = getStatusTotals([{ status: 'gone', amount: 50 }], statuses);
    expect(totals).toEqual([
      { key: 'gone', label: 'gone', color: 'gray', amount: 50 },
    ]);
  });
});

describe('getStaleRowBg', () => {
  const statuses = [
    { key: 'wip', group_name: 'in_progress', color: 'blue' },
    { key: 'review', group_name: 'pending', color: 'blue' },
    { key: 'paid', group_name: 'complete', color: 'blue' },
  ] as UserStatus[];
  const longAgo = '2020-01-01T00:00:00Z';

  it('highlights a stale in-progress row', () => {
    expect(getStaleRowBg(statuses, 'wip', longAgo)).not.toBe('');
  });

  it('never highlights a pending row, however long it sat', () => {
    expect(getStaleRowBg(statuses, 'review', longAgo)).toBe('');
  });

  it('never highlights a completed row', () => {
    expect(getStaleRowBg(statuses, 'paid', longAgo)).toBe('');
  });
});

describe('getAttentionScore', () => {
  const longAgo = '2020-01-01T00:00:00Z';
  const row = (payment_date: string | null, status_changed_at = longAgo) => ({
    status: 'x',
    status_changed_at,
    payment_date,
  });

  it('ranks pending by missed payment date, not by time in status', () => {
    expect(
      getAttentionScore(row('2026-11-01'), 'pending', now)
    ).toBeGreaterThan(0);
    expect(getAttentionScore(row('2026-11-02'), 'pending', now)).toBeLessThan(
      0
    );
    expect(getAttentionScore(row(null), 'pending', now)).toBe(-Infinity);
  });

  it('ranks other groups by whichever is more overdue', () => {
    expect(getAttentionScore(row(null), 'todo', now)).toBeGreaterThan(0);
    expect(
      getAttentionScore(
        row('2026-10-01', new Date().toISOString()),
        'todo',
        now
      )
    ).toBeGreaterThan(0);
  });

  it('never ranks done tasks', () => {
    expect(getAttentionScore(row('2026-10-01'), 'complete', now)).toBe(
      -Infinity
    );
  });
});

describe('getReviewerTotal', () => {
  it('sums only tasks marked as a review', () => {
    expect(
      getReviewerTotal([
        { amount: 175, is_reviewer: true },
        { amount: 250, is_reviewer: false },
        { amount: 300, is_reviewer: null },
        { amount: null, is_reviewer: true },
        { amount: 125, is_reviewer: true },
      ])
    ).toBe(300);
  });
});
