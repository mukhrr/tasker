import { describe, expect, it } from 'vitest';
import { statusesForRole, taskRole, whoseTurn } from './role';

describe('taskRole', () => {
  it('treats only true as reviewer', () => {
    expect(taskRole({ is_reviewer: true })).toBe('reviewer');
    expect(taskRole({ is_reviewer: false })).toBe('contributor');
    expect(taskRole({ is_reviewer: null })).toBe('contributor');
  });
});

describe('whoseTurn', () => {
  it('reads the reviewer statuses', () => {
    expect(whoseTurn('assigned', 'reviewer')).toBe('me');
    expect(whoseTurn('review_due', 'reviewer')).toBe('me');
    expect(whoseTurn('waiting_on_author', 'reviewer')).toBe('author');
    expect(whoseTurn('approved', 'reviewer')).toBe('merge');
    expect(whoseTurn('paid', 'reviewer')).toBeNull();
  });

  it('has no turn for committer tasks', () => {
    expect(whoseTurn('review_due', 'contributor')).toBeNull();
  });
});

describe('statusesForRole', () => {
  const s = (key: string, role: 'both' | 'contributor' | 'reviewer') => ({
    key,
    role,
  });
  const all = [
    s('promising', 'contributor'),
    s('assigned', 'both'),
    s('review_due', 'reviewer'),
    s('paid', 'both'),
  ];

  it('lists a tab its own statuses and the shared ones', () => {
    expect(statusesForRole(all, 'contributor').map((x) => x.key)).toEqual([
      'promising',
      'assigned',
      'paid',
    ]);
    expect(statusesForRole(all, 'reviewer').map((x) => x.key)).toEqual([
      'assigned',
      'review_due',
      'paid',
    ]);
  });

  it('keeps the current status even when it belongs to the other tab', () => {
    expect(
      statusesForRole(all, 'reviewer', 'promising').map((x) => x.key)
    ).toContain('promising');
  });
});
