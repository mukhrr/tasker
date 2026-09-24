import type { UserStatus, TaskStatusGroup } from '@/types/database';
import type { TaskFacts } from './facts';

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
    rules.push(`**changes_required**: the developer's open PR needs their action for any of:
1. \`failing_checks\` is non-empty (TypeScript, tests, lint, or any CI job) or \`merge_conflicts\` is true
2. \`latest_human_review_state\` is CHANGES_REQUESTED and \`pushed_after_changes_requested\` is false
Bot reviews (Claude reviewers, melvin) never count, and a review the developer left on someone else's PR never counts. \`failing_checks\` null means GitHub did not report CI state: do not infer passing, keep the current status unless reviews say otherwise. When you choose this status, the summary MUST list exactly what has to change: the failing check names, "merge conflicts", or the reviewer's requests. If the developer already pushed after the request and checks pass, use **reviewing**.`);
  }
  if (keys.has('approved')) {
    rules.push(
      `**approved**: the PR is open, not merged, and the latest human review (the C+ reviewer) is APPROVED with no failing checks. Bot approvals do not count.`
    );
  }
  if (keys.has('reviewing')) {
    rules.push(
      `**reviewing**: the developer's PR is open, not draft, checks pass, no conflicts, no unaddressed change requests, and no human APPROVED review yet. The developer is waiting on the C+ reviewer.`
    );
  }
  if (keys.has('awaiting_payment')) {
    rules.push(
      `**awaiting_payment**: the PR is merged AND \`payment_overdue_days\` is present and >= 0 (payment is due 7 days after the production deploy). Merged with no production deploy, or \`payment_overdue_days\` below 0, stays **merged**.`
    );
  }
  if (keys.has('hold')) {
    rules.push(
      `**hold**: the issue or PR is explicitly blocked on something outside the developer's control: a pending design decision, backend changes, or another PR/issue that must land first. Look for comments saying hold, blocked, waiting on, or a HOLD label/title prefix.`
    );
  }
  rules.push(
    `**Manual statuses**: a status whose description says it is set manually is never suggested. If the current status is one of them, return it unchanged.`
  );
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
4. Bounty lost: issue closed without the developer's PR merged, or the open issue is assigned to another contributor while the developer has no PR (Help Wanted removed and someone else assigned). Use the Complete-group status for abandoned/closed work.
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
  "payment_date": "<ISO date payment is due or was made, or null>",
  "amount": <bounty amount in USD from the title, labels, body or comments, or null>
}

Return null for any field you cannot confirm; null keeps the existing value. Only return pr_url when you are confident the PR is the developer's PR for this issue.

payment_date: if a comment states an actual payment date, use it. Otherwise use \`payment_due_at\` from Computed Facts when it is present. Otherwise null. Never calculate a date yourself.

## Confidence

Your confidence controls what is applied:
- >= 0.75: status change applied
- >= 0.6: summary and fields updated, status unchanged
- < 0.6: nothing updated

0.9-1.0 unambiguous (PR merged, payment comment, explicit assignment); 0.75-0.9 strong with minor ambiguity; 0.6-0.75 enough for a summary but not a status change; below 0.6 weak or conflicting.

If the context says the user changed the status by hand since the last sync, still report the status the evidence supports with honest confidence; the app decides whether to apply it.`;
}

// Used when Jev owns the status: the model only writes the summary and
// pulls out fields, so the taxonomy and confidence guidance are dead weight.
export function buildGenerationPrompt(statuses: UserStatus[]): string {
  const statusKeys = statuses.map((s) => `"${s.key}"`).join(', ');
  return `You analyze GitHub activity for an open-source bounty developer's task tracker.

The task's status has already been decided; you do not choose it. Write the summary and pull out the fields.

Return ONLY a JSON object, no prose and no code fences:
{
  "suggestedStatus": "<echo the status given in the context, one of: ${statusKeys}>",
  "confidence": 1,
  "summary": "<2-3 sentence summary of current state>",
  "flags": ["<concerns or notable items>"],
  "issue_title": "<the GitHub issue title, exactly>",
  "pr_url": "<the developer's PR URL for this issue, or null>",
  "assigned_date": "<ISO date the developer was assigned, or null>",
  "payment_date": "<ISO date, see below, or null>",
  "amount": <bounty amount in USD, or null>
}

Return null for any field you cannot confirm; null keeps the existing value.

payment_date: if a comment states an actual payment date, use it. Otherwise use \`payment_due_at\` from Computed Facts when it is present. Otherwise null. Never calculate a date yourself.`;
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
  assignedToOther?: boolean;
  facts?: TaskFacts;
}): string {
  let prompt = '';

  prompt += `## Context\n`;
  prompt += `GitHub username: **${data.githubUsername}**\n`;
  prompt += `Current task status: **${data.currentStatus}**\n`;
  prompt += `First sync: **${data.isFirstSync ? 'yes' : 'no'}**\n`;

  if (data.wasManuallyEdited) {
    prompt += `User changed the status by hand since the last sync: **yes**\n`;
  }
  if (data.assignedToOther) {
    prompt += `Issue is open and assigned to another contributor, not the developer, and the developer has no PR: **yes** (the bounty went to someone else)\n`;
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

  if (data.facts) {
    const known = Object.entries(data.facts).filter(([, v]) => v !== null);
    if (known.length) {
      prompt += `## Computed Facts\nThese are computed from the data below, not guesses. Trust them over your own reading of dates.\n${JSON.stringify(
        Object.fromEntries(known)
      )}\n\n`;
    }
  }

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
