import { parseIssueUrl } from '@/lib/github';
import type { Task, TaskStatusGroup } from '@/types/database';
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

// Unlike issueKey this ignores a comment id: a row linked to a comment on
// an issue is synced as that issue, so it already tracks it.
function issueRef(t: Partial<TrackedRow> & { issue_url: string }): string {
  const parsed = parseIssueUrl(t.issue_url);
  const owner = t.repo_owner ?? parsed?.owner;
  const repo = t.repo_name ?? parsed?.repo;
  const number = t.issue_number ?? parsed?.number;
  return (
    owner && repo && number ? `${owner}/${repo}#${number}` : t.issue_url
  ).toLowerCase();
}

// alreadyAdded holds issues earlier syncs inserted, so a row the user
// deleted since is not added again.
export function newHits(
  hits: SearchHit[],
  existing: TrackedRow[],
  alreadyAdded: string[] = []
): SearchHit[] {
  const tracked = new Set([
    ...existing.map(issueRef),
    ...alreadyAdded.map((issue_url) => issueRef({ issue_url })),
  ]);
  return hits.filter(
    (h) => !h.pull_request && !tracked.has(issueRef({ issue_url: h.html_url }))
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

export interface NewTask {
  issue_url: string;
  issue_title: string;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  status: string;
  status_group: TaskStatusGroup;
  assigned_date: string;
  note: string;
}

export interface DiscoveryDeps {
  search(since: string): Promise<SearchHit[]>;
  events(owner: string, repo: string, number: number): Promise<GitHubEvent[]>;
  trackedRows(): Promise<TrackedRow[]>;
  // Issue URLs that syncs since the given date inserted.
  offeredUrls(since: string): Promise<string[]>;
  insert(task: NewTask): Promise<string>;
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// Never throws: a search rate limit must not cost the user their sync.
export async function discoverAssigned(
  deps: DiscoveryDeps,
  opts: {
    username: string;
    assignedStatus: { key: string; group_name: TaskStatusGroup } | undefined;
    now: Date;
  }
): Promise<{ discovered: DiscoveredTask[]; errors: string[] }> {
  const { username, assignedStatus, now } = opts;
  const discovered: DiscoveredTask[] = [];
  const errors: string[] = [];
  if (!assignedStatus) {
    return {
      discovered,
      errors: ['New assigned issues were not added: no "assigned" status.'],
    };
  }

  let fresh: SearchHit[];
  try {
    const since = searchCutoff(now);
    const hits = await deps.search(since);
    if (hits.length === 0) return { discovered, errors };
    fresh = newHits(
      hits,
      await deps.trackedRows(),
      await deps.offeredUrls(since)
    );
  } catch (err) {
    return {
      discovered,
      errors: [`Looking for newly assigned issues failed: ${message(err)}`],
    };
  }

  for (const hit of fresh) {
    const target = parseIssueUrl(hit.html_url);
    if (!target) continue;
    try {
      const events = await deps.events(
        target.owner,
        target.repo,
        target.number
      );
      const assignedAt = recentAssignment(events, username, now);
      if (!assignedAt) continue;
      const taskId = await deps.insert({
        issue_url: hit.html_url,
        issue_title: hit.title,
        repo_owner: target.owner,
        repo_name: target.repo,
        issue_number: target.number,
        status: assignedStatus.key,
        status_group: assignedStatus.group_name,
        assigned_date: assignedAt,
        note: 'Added by sync',
      });
      discovered.push({
        taskId,
        issue_url: hit.html_url,
        issue_title: hit.title,
      });
    } catch (err) {
      errors.push(`Could not add ${hit.html_url}: ${message(err)}`);
    }
  }
  return { discovered, errors };
}
