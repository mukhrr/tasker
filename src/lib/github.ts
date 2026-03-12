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

export function shortenGitHubUrl(url: string): string {
  const issueMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (issueMatch) return `${issueMatch[1]}/${issueMatch[2]}#${issueMatch[3]}`;

  const prMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (prMatch) return `${prMatch[1]}/${prMatch[2]}#${prMatch[3]}`;

  return url;
}
