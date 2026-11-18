import { describe, expect, it } from 'vitest';
import { computeDashboardStats, paidMonth } from './use-dashboard-stats';

describe('paidMonth', () => {
  it('uses the month the task moved to complete, not an earlier due date', () => {
    expect(
      paidMonth({
        payment_date: '2026-09-28',
        status_changed_at: '2026-10-02T10:00:00Z',
        created_at: '2026-08-10T10:00:00Z',
      })
    ).toBe('2026-10');
  });

  it('ignores a later due date when paid early', () => {
    expect(
      paidMonth({
        payment_date: '2026-10-03',
        status_changed_at: '2026-09-29T10:00:00Z',
        created_at: '2026-08-10T10:00:00Z',
      })
    ).toBe('2026-09');
  });

  it('uses payment_date for a task created already complete', () => {
    expect(
      paidMonth({
        payment_date: '2026-05-20',
        status_changed_at: '2026-09-01T10:00:00.400Z',
        created_at: '2026-09-01T10:00:00Z',
      })
    ).toBe('2026-05');
  });
});

describe('computeDashboardStats reviewer split', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const task = (over: object) => ({
    status_group: 'complete' as const,
    amount: 100,
    payment_date: null,
    status_changed_at: '2026-10-10T10:00:00Z',
    created_at: '2026-09-01T10:00:00Z',
    is_reviewer: null as boolean | null,
    ...over,
  });
  const stats = computeDashboardStats(
    [
      task({ amount: 250 }),
      task({ amount: 125, is_reviewer: true }),
      task({ amount: 60, is_reviewer: false }),
      task({ amount: 75, is_reviewer: true, status_group: 'in_progress' }),
      task({ amount: 500, status_group: 'pending' }),
    ],
    now
  );

  it('keeps reviewer money inside the totals', () => {
    expect(stats.totalEarned).toBe(435);
    expect(stats.pendingAmount).toBe(575);
  });

  it('reports the reviewer part of earned and pending', () => {
    expect(stats.reviewerEarned).toBe(125);
    expect(stats.reviewerPending).toBe(75);
  });

  it('reports the reviewer part of last month', () => {
    expect(stats.lastMonthEarned).toBe(435);
    expect(stats.lastMonthReviewerEarned).toBe(125);
  });

  it('carries the reviewer part on each month of the chart', () => {
    const october = stats.earningsOverTime.find((m) => m.month === 'Oct 2026');
    expect(october).toEqual({ month: 'Oct 2026', amount: 435, reviewer: 125 });
  });
});
