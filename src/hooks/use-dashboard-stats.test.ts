import { describe, expect, it } from 'vitest';
import { paidMonth } from './use-dashboard-stats';

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
