import { describe, it, expect } from 'vitest';
import { paymentMoveTarget } from './payment-move';
import type { GitHubComment } from '@/types/github';

const said = (body: string) => [{ body } as GitHubComment];
const url = 'https://github.com/Expensify/App/issues/84139';

describe('paymentMoveTarget', () => {
  it('keeps an issue a comment links by number', () => {
    expect(
      paymentMoveTarget(
        url,
        said('payment will be handled in #84139'),
        'Expensify',
        'App',
        83782
      )
    ).toBe(url);
  });

  it('keeps an issue a comment links by URL, whatever the case', () => {
    expect(
      paymentMoveTarget(
        url.toLowerCase(),
        said(`handled in ${url}`),
        'Expensify',
        'App',
        83782
      )
    ).toBe(url);
  });

  it('drops an issue no comment mentions', () => {
    expect(
      paymentMoveTarget(
        url,
        said('handled in #84130'),
        'Expensify',
        'App',
        83782
      )
    ).toBeNull();
  });

  it('drops the current issue, another repo, and non-URLs', () => {
    expect(
      paymentMoveTarget(url, said('#84139'), 'Expensify', 'App', 84139)
    ).toBeNull();
    expect(
      paymentMoveTarget(url, said('#84139'), 'Other', 'App', 1)
    ).toBeNull();
    expect(
      paymentMoveTarget(null, said('#84139'), 'Expensify', 'App', 1)
    ).toBeNull();
  });
});
