import type { WatchlistEntry } from './types';

const WATCHLIST_KEY = 'watchlist';
const GH_NAME = /^[a-zA-Z0-9._-]+$/;

export async function getWatchlist(): Promise<WatchlistEntry[]> {
  const stored = await chrome.storage.local.get(WATCHLIST_KEY);
  const raw = stored[WATCHLIST_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is WatchlistEntry =>
      typeof e?.owner === 'string' && typeof e?.repo === 'string',
  );
}

export async function addWatchlistEntry(owner: string, repo: string): Promise<WatchlistEntry[]> {
  if (!GH_NAME.test(owner) || !GH_NAME.test(repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const list = await getWatchlist();
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  if (list.some((e) => `${e.owner.toLowerCase()}/${e.repo.toLowerCase()}` === key)) {
    return list;
  }
  const next = [...list, { owner, repo }];
  await chrome.storage.local.set({ [WATCHLIST_KEY]: next });
  return next;
}

export async function removeWatchlistEntry(owner: string, repo: string): Promise<WatchlistEntry[]> {
  const list = await getWatchlist();
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const next = list.filter((e) => `${e.owner.toLowerCase()}/${e.repo.toLowerCase()}` !== key);
  await chrome.storage.local.set({ [WATCHLIST_KEY]: next });
  return next;
}

export function parseRepoInput(input: string): WatchlistEntry | null {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '');
  const match = trimmed.match(/^([^/\s]+)\/([^/\s]+)(?:\/.*)?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!GH_NAME.test(owner) || !GH_NAME.test(repo)) return null;
  return { owner, repo };
}
