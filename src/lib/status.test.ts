import { describe, expect, it } from 'vitest';
import type { UserStatus } from '@/types/database';
import { getStatusTotals, isPaymentOverdue } from './status';

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
