import { issueKey } from '@/lib/github';
import type { Task } from '@/types/database';
import type { GitHubEvent } from '@/types/github';

export const DISCOVERY_WINDOW_DAYS = 14;
const WINDOW_MS = DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface SearchHit {
  html_url: string;
  title: string;
  number: number;
  pull_request?: unknown;
}

export interface DiscoveredTask {
  taskId: string;
  issue_url: string;
  issue_title: string;
}

type TrackedRow = Pick<
  Task,
  'issue_url' | 'repo_owner' | 'repo_name' | 'issue_number'
>;

export function searchCutoff(now: Date): string {
  return new Date(now.getTime() - WINDOW_MS).toISOString().slice(0, 10);
}

export function newHits(
  hits: SearchHit[],
  existing: TrackedRow[]
): SearchHit[] {
  const tracked = new Set(existing.map(issueKey));
  return hits.filter(
    (h) => !h.pull_request && !tracked.has(issueKey({ issue_url: h.html_url }))
  );
}

// The latest assignment decides, not the first: someone unassigned months
// ago and assigned again this week is a new task.
export function recentAssignment(
  events: GitHubEvent[],
  username: string,
  now: Date
): string | null {
  const login = username.toLowerCase();
  const latest = events
    .filter(
      (e) =>
        e.event === 'assigned' && e.assignee?.login?.toLowerCase() === login
    )
    .map((e) => e.created_at)
    .sort()
    .at(-1);
  if (!latest) return null;
  return now.getTime() - new Date(latest).getTime() <= WINDOW_MS
    ? latest
    : null;
}
