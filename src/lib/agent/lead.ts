import type { GitHubComment } from '@/types/github';
import type { UserStatus } from '@/types/database';

// A lead is a bug the developer reported in a comment on someone's PR, kept
// as a task in case it becomes a new paid issue.
export type LeadOutcome =
  | 'new_issue'
  | 'fixed_in_pr'
  | 'duplicate'
  | 'declined'
  | 'pending';

export interface LeadCandidate {
  url: string;
  number: number;
  title: string;
  state: string;
  assignees: string[];
  created_at: string;
}

export interface LeadResult {
  outcome: LeadOutcome;
  newIssueUrl: string | null;
  confidence: number;
  summary: string;
}

export interface LeadUpdate {
  suggestedStatus: string;
  confidence: number;
  summary: string;
  issue_url?: string;
}

const DEAD: LeadOutcome[] = ['fixed_in_pr', 'duplicate', 'declined'];
const RELINK_CONFIDENCE = 0.75;
const LOST_STATUS = 'wasted';
// Every release links its PRs from a checklist issue; none of those is a lead.
const NOISE_ISSUE_RE = /deploy checklist/i;
const ISSUE_LINK_RE = /github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/g;

interface TimelineIssue {
  number: number;
  html_url: string;
  title: string;
  state: string;
  created_at: string;
  assignees?: { login: string }[];
  pull_request?: unknown;
  repository?: { full_name?: string };
}

function toCandidate(i: TimelineIssue): LeadCandidate {
  return {
    url: i.html_url,
    number: i.number,
    title: i.title,
    state: i.state,
    assignees: (i.assignees ?? []).map((a) => a.login),
    created_at: i.created_at,
  };
}

// Issues that cross-reference the PR after the lead was posted. A new issue
// opened for the bug nearly always links back to the PR it was found on.
export function crossReferencedIssues(
  timeline: Record<string, unknown>[],
  since: string
): LeadCandidate[] {
  const seen = new Set<string>();
  const out: LeadCandidate[] = [];
  for (const e of timeline) {
    if (e.event !== 'cross-referenced') continue;
    if (typeof e.created_at !== 'string' || e.created_at < since) continue;
    const issue = (e.source as { issue?: TimelineIssue } | undefined)?.issue;
    if (!issue || issue.pull_request || NOISE_ISSUE_RE.test(issue.title)) {
      continue;
    }
    if (seen.has(issue.html_url)) continue;
    seen.add(issue.html_url);
    out.push(toCandidate(issue));
  }
  return out;
}

// Issue numbers linked in the replies, e.g. MelvinBot naming a duplicate.
export function mentionedIssueNumbers(
  replies: GitHubComment[],
  owner: string,
  repo: string,
  exclude: number[]
): number[] {
  const found = new Set<number>();
  for (const c of replies) {
    for (const m of c.body.matchAll(ISSUE_LINK_RE)) {
      if (
        m[1].toLowerCase() === owner.toLowerCase() &&
        m[2].toLowerCase() === repo.toLowerCase()
      ) {
        const n = parseInt(m[3], 10);
        if (!exclude.includes(n)) found.add(n);
      }
    }
  }
  return [...found];
}

// Status is decided here, not by the model: the outcome is what the model
// judges, and what each outcome means for the task is the user's rule.
export function leadUpdate(
  result: LeadResult,
  candidates: LeadCandidate[],
  currentStatus: string,
  statuses: UserStatus[]
): LeadUpdate {
  const update: LeadUpdate = {
    suggestedStatus: currentStatus,
    confidence: result.confidence,
    summary: result.summary,
  };
  if (DEAD.includes(result.outcome)) {
    if (statuses.some((s) => s.key === LOST_STATUS)) {
      update.suggestedStatus = LOST_STATUS;
    }
    return update;
  }
  if (
    result.outcome === 'new_issue' &&
    result.confidence >= RELINK_CONFIDENCE &&
    result.newIssueUrl &&
    candidates.some((c) => c.url === result.newIssueUrl)
  ) {
    update.issue_url = result.newIssueUrl;
  }
  return update;
}

export function parseLeadResult(content: string): LeadResult | null {
  const json = content.match(/\{[\s\S]*\}/);
  if (!json) return null;
  try {
    const r = JSON.parse(json[0]);
    const outcomes: LeadOutcome[] = [...DEAD, 'new_issue', 'pending'];
    if (!outcomes.includes(r.outcome) || typeof r.confidence !== 'number') {
      return null;
    }
    return {
      outcome: r.outcome,
      newIssueUrl: typeof r.newIssueUrl === 'string' ? r.newIssueUrl : null,
      confidence: r.confidence,
      summary: typeof r.summary === 'string' ? r.summary : '',
    };
  } catch {
    return null;
  }
}
