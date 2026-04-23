export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  number: number;
  type: 'issue' | 'pr';
}

export interface ParsedIssuesListUrl {
  owner: string;
  repo: string;
}

export function parseIssuesListUrl(url: string): ParsedIssuesListUrl | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/?(?:\?.*)?(?:#.*)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const issueMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (issueMatch) {
    return { owner: issueMatch[1], repo: issueMatch[2], number: parseInt(issueMatch[3], 10), type: 'issue' };
  }

  const prMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (prMatch) {
    return { owner: prMatch[1], repo: prMatch[2], number: parseInt(prMatch[3], 10), type: 'pr' };
  }

  return null;
}
