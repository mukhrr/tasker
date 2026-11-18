import { describe, it, expect } from 'vitest';
import { newHits, recentAssignment, searchCutoff } from './discover';
import type { GitHubEvent } from '@/types/github';

const hit = (number: number, over = {}) => ({
  html_url: `https://github.com/Expensify/App/issues/${number}`,
  title: `Issue ${number}`,
  number,
  ...over,
});

const row = (over = {}) => ({
  issue_url: 'https://github.com/Expensify/App/issues/1',
  repo_owner: 'Expensify',
  repo_name: 'App',
  issue_number: 1,
  ...over,
});

const assigned = (login: string, created_at: string) =>
  ({ event: 'assigned', created_at, assignee: { login } }) as GitHubEvent;

const NOW = new Date('2026-11-18T10:00:00Z');

describe('newHits', () => {
  it('keeps an issue that has no row', () => {
    expect(newHits([hit(2)], [row()])).toEqual([hit(2)]);
  });

  it('drops an issue already tracked by its columns', () => {
    expect(newHits([hit(1)], [row()])).toEqual([]);
  });

  it('drops an issue tracked only by a markdown link with empty columns', () => {
    const existing = row({
      issue_url:
        '[https://github.com/Expensify/App/issues/1](https://github.com/Expensify/App/issues/1)',
      repo_owner: null,
      repo_name: null,
      issue_number: null,
    });
    expect(newHits([hit(1)], [existing])).toEqual([]);
  });

  it('matches owner and repo case-insensitively', () => {
    const existing = row({ repo_owner: 'expensify', repo_name: 'app' });
    expect(newHits([hit(1)], [existing])).toEqual([]);
  });

  it('drops pull requests', () => {
    expect(newHits([hit(2, { pull_request: {} })], [])).toEqual([]);
  });

  it('keeps an issue when only a comment on it is tracked', () => {
    const lead = row({
      issue_url: 'https://github.com/Expensify/App/issues/1#issuecomment-555',
    });
    expect(newHits([hit(1)], [lead])).toEqual([hit(1)]);
  });
});

describe('recentAssignment', () => {
  it('returns the latest assignment of the user', () => {
    const events = [
      assigned('mukhrr', '2026-11-06T00:00:00Z'),
      assigned('mukhrr', '2026-11-15T00:00:00Z'),
    ];
    expect(recentAssignment(events, 'mukhrr', NOW)).toBe(
      '2026-11-15T00:00:00Z'
    );
  });

  it('is null when the latest assignment is older than 14 days', () => {
    const events = [assigned('mukhrr', '2026-11-03T00:00:00Z')];
    expect(recentAssignment(events, 'mukhrr', NOW)).toBeNull();
  });

  it("ignores someone else's assignment", () => {
    const events = [assigned('other', '2026-11-15T00:00:00Z')];
    expect(recentAssignment(events, 'mukhrr', NOW)).toBeNull();
  });

  it('matches the username case-insensitively', () => {
    const events = [assigned('Mukhrr', '2026-11-15T00:00:00Z')];
    expect(recentAssignment(events, 'mukhrr', NOW)).toBe(
      '2026-11-15T00:00:00Z'
    );
  });
});

describe('searchCutoff', () => {
  it('is the date 14 days back', () => {
    expect(searchCutoff(NOW)).toBe('2026-11-04');
  });
});
