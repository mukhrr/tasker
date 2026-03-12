import type { UserStatus, TaskStatusGroup } from '@/types/database';

const STATUS_GROUP_LABELS: Record<TaskStatusGroup, string> = {
  todo: 'To-do',
  in_progress: 'In Progress',
  complete: 'Complete',
};

function buildStatusTaxonomy(statuses: UserStatus[]): string {
  const groups: Record<TaskStatusGroup, UserStatus[]> = {
    todo: [],
    in_progress: [],
    complete: [],
  };
  for (const s of statuses) {
    groups[s.group_name]?.push(s);
  }

  let section = '## Status Taxonomy\n\n';
  for (const group of ['todo', 'in_progress', 'complete'] as TaskStatusGroup[]) {
    section += `### ${STATUS_GROUP_LABELS[group]}\n`;
    for (const s of groups[group].sort((a, b) => a.position - b.position)) {
      section += `- **${s.key}** (${s.label})`;
      if (s.description) {
        section += ` — ${s.description}`;
      }
      section += '\n';
    }
    section += '\n';
  }
  return section;
}

export function buildSystemPrompt(statuses: UserStatus[]): string {
  const statusKeys = statuses.map((s) => `"${s.key}"`).join(', ');

  return `You are an AI agent that analyzes GitHub activity for an open-source bounty developer's task tracker.

Your job is to determine the current status of a task AND populate task fields based on GitHub data.
The developer tracks bounties across GitHub repos. Each task is an issue they're working on or proposing to work on.

## The Developer
You are given the developer's GitHub username. Use it to determine:
- Whether they are assigned to the issue
- Which PRs are theirs
- Which comments/reviews are directed at them vs. written by them
- Whether they are tagged or mentioned

${buildStatusTaxonomy(statuses)}
## Detection Rules

Use the status descriptions above to determine the correct status. Match the current GitHub state to the most specific status whose description fits. When multiple statuses could apply, pick the one that is most specific to the observed activity.

General priority order:
1. Payment/completion signals (paid, awaiting_payment)
2. PR state signals (merged, changes_required, reviewing)
3. Assignment signals (assigned)
4. Issue state signals (wasted if closed without merge)
5. Proposal/early signals (got_cplus, update_proposal, promising)
6. Default to the first status in the to-do group

## Response Format

Return valid JSON with ALL of these fields:
{
  "suggestedStatus": "<one of: ${statusKeys}>",
  "confidence": <0.0 to 1.0>,
  "summary": "<2-3 sentence summary of current state>",
  "flags": ["<any concerns or notable items>"],
  "issue_title": "<the GitHub issue title>",
  "pr_url": "<full GitHub PR URL if discovered, or null>",
  "assigned_date": "<ISO date string when the developer was assigned, or null>",
  "payment_date": "<ISO date string if payment date found in comments, or null>",
  "amount": <bounty amount in USD if found in comments/labels, or null>
}

Rules for fields:
- **issue_title**: Always set to the GitHub issue title exactly as it appears.
- **pr_url**: Only return a PR URL if you're confident it's the developer's PR for this issue. Return null to keep existing.
- **assigned_date**: Date when the developer was assigned. Return null to keep existing.
- **payment_date**: Only if you find explicit payment date mentions. Return null otherwise.
- **amount**: Only if you find explicit bounty/payment amounts in labels, comments, or issue body. Return null otherwise.
- Return null for any field you don't want to change.

Analyze all provided data carefully. Consider the chronological order of events.
Be conservative with status changes — only suggest a new status if the evidence is clear.`;
}

export function buildAnalysisPrompt(data: {
  currentStatus: string;
  isFirstSync: boolean;
  githubUsername: string;
  issueTitle?: string;
  issueData?: string;
  prData?: string;
  comments?: string;
  reviews?: string;
  events?: string;
  existingPrUrl?: string | null;
  existingAssignedDate?: string | null;
  existingAmount?: number | null;
  existingPaymentDate?: string | null;
  discoveredPrUrl?: string | null;
  discoveredAssignedDate?: string | null;
}): string {
  let prompt = '';

  prompt += `## Context\n`;
  prompt += `GitHub username: **${data.githubUsername}**\n`;
  prompt += `Current task status: **${data.currentStatus}**\n`;
  prompt += `First sync: **${data.isFirstSync ? 'YES — populate all fields from scratch' : 'NO — only update changed fields'}**\n\n`;

  if (data.existingPrUrl) {
    prompt += `Existing PR URL: ${data.existingPrUrl}\n`;
  }
  if (data.existingAssignedDate) {
    prompt += `Existing assigned date: ${data.existingAssignedDate}\n`;
  }
  if (data.existingAmount) {
    prompt += `Existing amount: $${data.existingAmount}\n`;
  }
  if (data.existingPaymentDate) {
    prompt += `Existing payment date: ${data.existingPaymentDate}\n`;
  }
  if (data.discoveredPrUrl) {
    prompt += `\nDiscovered linked PR: ${data.discoveredPrUrl}\n`;
  }
  if (data.discoveredAssignedDate) {
    prompt += `Discovered assigned date: ${data.discoveredAssignedDate}\n`;
  }

  prompt += '\n';

  if (data.issueData) {
    prompt += `## Issue Data\n${data.issueData}\n\n`;
  }
  if (data.prData) {
    prompt += `## Pull Request Data\n${data.prData}\n\n`;
  }
  if (data.comments) {
    prompt += `## Comments (last 30)\n${data.comments}\n\n`;
  }
  if (data.reviews) {
    prompt += `## PR Reviews\n${data.reviews}\n\n`;
  }
  if (data.events) {
    prompt += `## Issue Events (last 30)\n${data.events}\n\n`;
  }

  prompt += `Based on the above GitHub data, analyze the current state of this task for developer **${data.githubUsername}** and return the JSON response with status and all applicable fields.`;

  return prompt;
}
