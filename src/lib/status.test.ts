import { describe, expect, it } from 'vitest';
import { isPaymentOverdue } from './status';

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
