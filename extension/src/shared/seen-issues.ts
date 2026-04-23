const SEEN_CAP = 500;

export function seenKey(owner: string, repo: string): string {
  return `seenHelpWanted:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export async function getSeen(owner: string, repo: string): Promise<Set<number>> {
  const key = seenKey(owner, repo);
  const res = await chrome.storage.local.get(key);
  const arr = (res[key] as number[] | undefined) ?? [];
  return new Set(arr);
}

export async function setSeen(owner: string, repo: string, seen: Set<number>): Promise<void> {
  const arr = Array.from(seen);
  const trimmed = arr.length > SEEN_CAP ? arr.slice(arr.length - SEEN_CAP) : arr;
  await chrome.storage.local.set({ [seenKey(owner, repo)]: trimmed });
}
