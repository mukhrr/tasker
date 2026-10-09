import { describe, expect, it } from 'vitest';
import { paidMonth } from './use-dashboard-stats';

describe('paidMonth', () => {
  it('uses the completion date when paid before the predicted due date', () => {
    expect(
      paidMonth({
        payment_date: '2026-10-03',
        status_changed_at: '2026-09-29T10:00:00Z',
      })
    ).toBe('2026-09');
  });

  it('uses payment_date when the task was marked complete later', () => {
    expect(
      paidMonth({
        payment_date: '2026-08-30',
        status_changed_at: '2026-09-04T10:00:00Z',
      })
    ).toBe('2026-08');
  });

  it('falls back to the completion date without payment_date', () => {
    expect(
      paidMonth({
        payment_date: null,
        status_changed_at: '2026-07-15T10:00:00Z',
      })
    ).toBe('2026-07');
  });
});
