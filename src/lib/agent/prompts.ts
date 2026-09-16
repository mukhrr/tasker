import type { UserStatus, TaskStatusGroup } from '@/types/database';

const STATUS_GROUP_LABELS: Record<TaskStatusGroup, string> = {
  todo: 'To-do',
  in_progress: 'In Progress',
  pending: 'Pending',
  complete: 'Complete',
};

function buildStatusTaxonomy(statuses: UserStatus[]): string {
  const groups: Record<TaskStatusGroup, UserStatus[]> = {
    todo: [],
    in_progress: [],
    pending: [],
    complete: [],
  };
  for (const s of statuses) {
    groups[s.group_name]?.push(s);
  }

  let section = '## Status Taxonomy\n\n';
  for (const group of [
    'todo',
    'in_progress',
    'pending',
    'complete',
  ] as TaskStatusGroup[]) {
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

// Shared response contract: embedded in the system prompt and handed to
// Codex as --output-schema (syncer/analyzers.ts). Status keys are validated
// against the user's taxonomy in the runner, not here, so the schema stays static.
export const TASK_UPDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'suggestedStatus',
    'confidence',
    'summary',
    'flags',
    'issue_title',
    'pr_url',
    'assigned_date',
    'payment_date',
    'amount',
  ],
  properties: {
    suggestedStatus: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string' },
    flags: { type: 'array', items: { type: 'string' } },
    issue_title: { type: ['string', 'null'] },
    pr_url: { type: ['string', 'null'] },
    assigned_date: { type: ['string', 'null'] },
    payment_date: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
  },
} as const;

function statusRules(keys: Set<string>): string {
  const rules: string[] = [];
  if (keys.has('changes_required')) {
    rules.push(`**changes_required**: only when ALL are true:
1. The developer's PR has a review with state "CHANGES_REQUESTED"
2. The developer has NOT pushed after that review (compare the PR's updated_at with the review's submitted_at)
3. The latest review is not APPROVED
If the developer pushed after the review, use **reviewing** instead. A review the developer left on someone else's PR never counts.`);
  }
  if (keys.has('paid')) {
    rules.push(
      `**paid**: only when the issue is **closed** AND a comment explicitly confirms payment ("paid", "payment sent", "payout", "invoice paid", a bounty bot payment comment). An open issue is NEVER paid, whatever the PR or comments about upcoming payment say.`
    );
  }
  if (!rules.length) return '';
  return `## Status Rules\n\n${rules.join('\n\n')}\n\n`;
}

export function buildSystemPrompt(statuses: UserStatus[]): string {
  const keys = new Set(statuses.map((s) => s.key));
  const statusKeys = statuses.map((s) => `"${s.key}"`).join(', ');

  return `You analyze GitHub activity for an open-source bounty developer's task tracker. Each task is an issue they are working on or have proposed on. Decide the task's current status and fill in its fields from the GitHub data.

## The Developer
You are given the developer's GitHub username. Use it to tell which PRs, comments and reviews are theirs, whether they are assigned, and whether they are being addressed.

${buildStatusTaxonomy(statuses)}## Detection Rules

Match the GitHub state to the most specific status whose description fits. Evidence priority, highest first:
1. Payment or completion signals (statuses in the Complete group)
2. PR state: merged, changes requested, under review
3. Assignment to the developer
4. Issue closed without the developer's PR merged
5. Proposal-stage signals (reviewer feedback, requests to update, interest)
6. Otherwise the first status in the To-do group

Consider the chronological order of events. Be conservative: suggest a new status only when the evidence is clear.

${statusRules(keys)}## Response Format

Return ONLY a JSON object, no prose and no code fences, with ALL of these fields:
{
  "suggestedStatus": "<one of: ${statusKeys}>",
  "confidence": <0.0 to 1.0>,
  "summary": "<2-3 sentence summary of current state>",
  "flags": ["<concerns or notable items>"],
  "issue_title": "<the GitHub issue title, exactly>",
  "pr_url": "<the developer's PR URL for this issue, or null>",
  "assigned_date": "<ISO date the developer was assigned, or null>",
  "payment_date": "<ISO date of payment if a comment states it, or null>",
  "amount": <bounty amount in USD from the title, labels, body or comments, or null>
}

Return null for any field you cannot confirm; null keeps the existing value. Only return pr_url when you are confident the PR is the developer's PR for this issue.

## Confidence

Your confidence controls what is applied:
- >= 0.75: status change applied
- >= 0.6: summary and fields updated, status unchanged
- < 0.6: nothing updated

0.9-1.0 unambiguous (PR merged, payment comment, explicit assignment); 0.75-0.9 strong with minor ambiguity; 0.6-0.75 enough for a summary but not a status change; below 0.6 weak or conflicting.

If the context says the user changed the status by hand since the last sync, still report the status the evidence supports with honest confidence; the app decides whether to apply it.`;
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
  wasManuallyEdited?: boolean;
}): string {
  let prompt = '';

  prompt += `## Context\n`;
  prompt += `GitHub username: **${data.githubUsername}**\n`;
  prompt += `Current task status: **${data.currentStatus}**\n`;
  prompt += `First sync: **${data.isFirstSync ? 'yes' : 'no'}**\n`;

  if (data.wasManuallyEdited) {
    prompt += `User changed the status by hand since the last sync: **yes**\n`;
  }

  prompt += '\n';

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
    prompt += `## Comments (most recent last)\n${data.comments}\n\n`;
  }
  if (data.reviews) {
    prompt += `## PR Reviews\n${data.reviews}\n\n`;
  }
  if (data.events) {
    prompt += `## Issue Events (chronological)\n${data.events}\n\n`;
  }

  prompt += `Analyze the current state of this task for developer **${data.githubUsername}** and return the JSON object.`;

  return prompt;
}
