import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllIssueEvents, searchAssignedIssues } from './github';

const respond = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

const page = (n: number, event = 'labeled') =>
  Array.from({ length: n }, (_, i) => ({ id: i, event }));

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllIssueEvents', () => {
  it('reads past the first 100 events', async () => {
    const late = { id: 999, event: 'assigned', assignee: { login: 'mukhrr' } };
    const fetchMock = vi.fn((url: string) =>
      respond(url.includes('page=2') ? [late] : page(100))
    );
    vi.stubGlobal('fetch', fetchMock);

    const events = await fetchAllIssueEvents('Expensify', 'App', 1, 't');

    expect(events).toHaveLength(101);
    expect(events.at(-1)).toEqual(late);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after a short first page', async () => {
    const fetchMock = vi.fn(() => respond(page(3)));
    vi.stubGlobal('fetch', fetchMock);

    await fetchAllIssueEvents('Expensify', 'App', 1, 't');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('searchAssignedIssues', () => {
  it('searches open issues assigned to the user since the cutoff', async () => {
    const items = [{ html_url: 'u', title: 't', number: 1 }];
    const fetchMock = vi.fn<(url: string) => ReturnType<typeof respond>>(() =>
      respond({ items })
    );
    vi.stubGlobal('fetch', fetchMock);

    const hits = await searchAssignedIssues('mukhrr', '2026-11-04', 't');

    expect(hits).toEqual(items);
    const url = decodeURIComponent(fetchMock.mock.calls[0][0]);
    expect(url).toContain(
      'is:issue is:open assignee:mukhrr updated:>=2026-11-04'
    );
    expect(url).toContain('sort=updated');
    expect(url).toContain('per_page=50');
  });
});
