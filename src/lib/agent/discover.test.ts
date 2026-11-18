import { describe, it, expect } from 'vitest';
import {
  discoverAssigned,
  newHits,
  recentAssignment,
  searchCutoff,
  type DiscoveryDeps,
  type NewTask,
} from './discover';
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

  it('drops an issue when a comment on it is the tracked link', () => {
    const viaComment = row({
      issue_url: 'https://github.com/Expensify/App/issues/1#issuecomment-555',
    });
    expect(newHits([hit(1)], [viaComment])).toEqual([]);
  });

  it('drops an issue an earlier sync already added', () => {
    expect(
      newHits([hit(2)], [], ['https://github.com/expensify/app/issues/2'])
    ).toEqual([]);
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

describe('discoverAssigned', () => {
  const status = { key: 'assigned', group_name: 'todo' as const };
  const setup = (over: Partial<DiscoveryDeps> = {}) => {
    const inserted: NewTask[] = [];
    const deps: DiscoveryDeps = {
      search: async () => [hit(2), hit(3)],
      events: async () => [assigned('mukhrr', '2026-11-15T00:00:00Z')],
      trackedRows: async () => [row()],
      offeredUrls: async () => [],
      insert: async (task) => {
        inserted.push(task);
        return `id-${task.issue_number}`;
      },
      ...over,
    };
    return { deps, inserted };
  };
  const run = (
    deps: DiscoveryDeps,
    assignedStatus: typeof status | undefined
  ) => discoverAssigned(deps, { username: 'mukhrr', assignedStatus, now: NOW });

  it('inserts each new issue as assigned with its assignment date', async () => {
    const { deps, inserted } = setup({ search: async () => [hit(2)] });

    const result = await run(deps, status);

    expect(inserted).toEqual([
      {
        issue_url: 'https://github.com/Expensify/App/issues/2',
        issue_title: 'Issue 2',
        repo_owner: 'Expensify',
        repo_name: 'App',
        issue_number: 2,
        status: 'assigned',
        status_group: 'todo',
        assigned_date: '2026-11-15T00:00:00Z',
        note: 'Added by sync',
      },
    ]);
    expect(result).toEqual({
      discovered: [
        {
          taskId: 'id-2',
          issue_url: 'https://github.com/Expensify/App/issues/2',
          issue_title: 'Issue 2',
        },
      ],
      errors: [],
    });
  });

  it('adds nothing and reports once when there is no assigned status', async () => {
    const { deps, inserted } = setup();

    const result = await run(deps, undefined);

    expect(inserted).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('still adds the other issues when one of them cannot be read', async () => {
    const { deps, inserted } = setup({
      events: async (_owner, _repo, number) => {
        if (number === 2) throw new Error('GitHub API error: 502');
        return [assigned('mukhrr', '2026-11-15T00:00:00Z')];
      },
    });

    const result = await run(deps, status);

    expect(inserted.map((t) => t.issue_number)).toEqual([3]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('issues/2');
  });

  it('reports a failed search instead of throwing', async () => {
    const { deps, inserted } = setup({
      search: async () => {
        throw new Error('rate limited');
      },
    });

    const result = await run(deps, status);

    expect(inserted).toEqual([]);
    expect(result.errors[0]).toContain('rate limited');
  });

  it('skips an issue assigned more than 14 days ago', async () => {
    const { deps, inserted } = setup({
      events: async () => [assigned('mukhrr', '2026-10-01T00:00:00Z')],
    });

    await run(deps, status);

    expect(inserted).toEqual([]);
  });
});
