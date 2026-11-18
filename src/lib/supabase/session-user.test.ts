import { describe, expect, it } from 'vitest';
import { userFromClaims } from './session-user';

describe('userFromClaims', () => {
  it('maps the token claims the app reads', () => {
    expect(
      userFromClaims({
        sub: 'user-1',
        email: 'dev@example.com',
        user_metadata: { user_name: 'mukhrr', avatar_url: 'https://a/b.png' },
        role: 'authenticated',
      })
    ).toEqual({
      id: 'user-1',
      email: 'dev@example.com',
      user_metadata: { user_name: 'mukhrr', avatar_url: 'https://a/b.png' },
    });
  });

  it('gives an empty metadata object when the token has none', () => {
    expect(userFromClaims({ sub: 'user-1' })).toEqual({
      id: 'user-1',
      email: undefined,
      user_metadata: {},
    });
  });

  it('is null without a subject', () => {
    expect(userFromClaims({ email: 'dev@example.com' })).toBeNull();
    expect(userFromClaims(null)).toBeNull();
  });
});
