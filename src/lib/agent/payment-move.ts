import type { GitHubComment } from '@/types/github';

// Expensify sometimes closes an issue and pays for it on another one ("payment
// and checklist will be handled in #84139"). The model names that issue; this
// keeps it only when a comment on the issue actually links it.
export function paymentMoveTarget(
  url: unknown,
  comments: GitHubComment[],
  owner: string,
  repo: string,
  currentNumber: number
): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) return null;
  if (
    m[1].toLowerCase() !== owner.toLowerCase() ||
    m[2].toLowerCase() !== repo.toLowerCase()
  ) {
    return null;
  }
  const number = parseInt(m[3], 10);
  if (number === currentNumber) return null;
  const linked = new RegExp(`(/issues/|#)${number}\\b`);
  if (!comments.some((c) => linked.test(c.body))) return null;
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}
