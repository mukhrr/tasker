import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubReview,
  GitHubEvent,
} from '@/types/github';

const GITHUB_API = 'https://api.github.com';

async function githubFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export function parseIssueUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export function parsePrUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export async function fetchIssue(
  owner: string,
  repo: string,
  number: number,
  token: string
): Promise<GitHubIssue> {
  return githubFetch<GitHubIssue>(`/repos/${owner}/${repo}/issues/${number}`, token);
}

export async function fetchPR(
  owner: string,
  repo: string,
  number: number,
  token: string
): Promise<GitHubPullRequest> {
  return githubFetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${number}`, token);
}

export async function fetchIssueComments(
  owner: string,
  repo: string,
  number: number,
  token: string
): Promise<GitHubComment[]> {
  return githubFetch<GitHubComment[]>(
    `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
    token
  );
}

export async function fetchPRReviews(
  owner: string,
  repo: string,
  number: number,
  token: string
): Promise<GitHubReview[]> {
  return githubFetch<GitHubReview[]>(
    `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    token
  );
}

export async function fetchIssueEvents(
  owner: string,
  repo: string,
  number: number,
  token: string
): Promise<GitHubEvent[]> {
  return githubFetch<GitHubEvent[]>(
    `/repos/${owner}/${repo}/issues/${number}/events?per_page=100`,
    token
  );
}

export async function fetchIssueTimeline(
  owner: string,
  repo: string,
  number: number,
  token: string
): Promise<Record<string, unknown>[]> {
  return githubFetch<Record<string, unknown>[]>(
    `/repos/${owner}/${repo}/issues/${number}/timeline?per_page=100`,
    token
  );
}

export async function findLinkedPR(
  owner: string,
  repo: string,
  issueNumber: number,
  githubUsername: string,
  token: string
): Promise<GitHubPullRequest | null> {
  try {
    // Use timeline API to find cross-referenced PRs
    const timeline = await fetchIssueTimeline(owner, repo, issueNumber, token);
    for (const event of timeline) {
      if (
        event.event === 'cross-referenced' &&
        event.source &&
        typeof event.source === 'object'
      ) {
        const source = event.source as Record<string, unknown>;
        const issue = source.issue as Record<string, unknown> | undefined;
        if (
          issue?.pull_request &&
          (issue.user as Record<string, unknown>)?.login === githubUsername
        ) {
          const prNumber = issue.number as number;
          return fetchPR(owner, repo, prNumber, token);
        }
      }
    }
  } catch {
    // Timeline API may not be available; fall back to search
  }

  // Fallback: search for PRs by user mentioning the issue
  try {
    const searchResult = await githubFetch<{ items: GitHubPullRequest[] }>(
      `/search/issues?q=repo:${owner}/${repo}+is:pr+author:${githubUsername}+${issueNumber}&per_page=5`,
      token
    );
    if (searchResult.items?.length) {
      // Fetch full PR data for the first match
      return fetchPR(owner, repo, searchResult.items[0].number, token);
    }
  } catch {
    // Search may fail; that's okay
  }

  return null;
}

export function shortenGitHubUrl(url: string): string {
  const issueMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (issueMatch) return `${issueMatch[1]}/${issueMatch[2]}#${issueMatch[3]}`;

  const prMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (prMatch) return `${prMatch[1]}/${prMatch[2]}#${prMatch[3]}`;

  return url;
}
