import { describe, it, expect } from 'vitest';
import { hasChangedSince } from './gate';

const base = {
  lastSyncedAt: '2026-09-20T00:00:00Z',
  userEdited: false,
  issueUpdatedAt: '2026-09-19T00:00:00Z',
  prUpdatedAt: null,
  commentDates: [],
  eventDates: [],
};

describe('hasChangedSince', () => {
  it('always analyses a task that has never synced', () => {
    expect(hasChangedSince({ ...base, lastSyncedAt: null })).toBe(true);
  });

  it('always analyses a task the user edited by hand', () => {
    expect(hasChangedSince({ ...base, userEdited: true })).toBe(true);
  });

  it('skips when nothing is newer than the last sync', () => {
    expect(hasChangedSince(base)).toBe(false);
  });

  it('analyses when the issue moved', () => {
    expect(
      hasChangedSince({ ...base, issueUpdatedAt: '2026-09-21T00:00:00Z' })
    ).toBe(true);
  });

  it('analyses when the PR moved', () => {
    expect(
      hasChangedSince({ ...base, prUpdatedAt: '2026-09-21T00:00:00Z' })
    ).toBe(true);
  });

  it('analyses on a new comment', () => {
    expect(
      hasChangedSince({
        ...base,
        commentDates: ['2026-09-01T00:00:00Z', '2026-09-22T00:00:00Z'],
      })
    ).toBe(true);
  });

  it('analyses on a new event', () => {
    expect(
      hasChangedSince({ ...base, eventDates: ['2026-09-22T00:00:00Z'] })
    ).toBe(true);
  });

  it('ignores comments and events older than the last sync', () => {
    expect(
      hasChangedSince({
        ...base,
        commentDates: ['2026-09-01T00:00:00Z'],
        eventDates: ['2026-09-02T00:00:00Z'],
      })
    ).toBe(false);
  });

  it('analyses when a date is unparsable rather than assuming nothing changed', () => {
    expect(hasChangedSince({ ...base, commentDates: ['whenever'] })).toBe(true);
  });
});
