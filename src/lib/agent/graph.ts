import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { buildSystemPrompt, buildAnalysisPrompt } from './prompts';
import type { Analyzer } from './llm';
import {
  fetchIssue,
  fetchPR,
  fetchIssueComments,
  fetchPRReviews,
  fetchIssueEvents,
  parseIssueUrl,
  parsePrUrl,
  findLinkedPR,
  fetchFailingChecks,
} from '@/lib/github';
import type { Task, TaskStatus, UserStatus } from '@/types/database';

export interface TaskUpdate {
  taskId: string;
  suggestedStatus: TaskStatus;
  confidence: number;
  summary: string;
  flags: string[];
  // Rich fields the AI can populate
  issue_title?: string | null;
  pr_url?: string | null;
  assigned_date?: string | null;
  payment_date?: string | null;
  amount?: number | null;
}

const GraphState = Annotation.Root({
  tasks: Annotation<Task[]>,
  githubToken: Annotation<string>,
  analyze: Annotation<Analyzer>,
  // Called as soon as a task's result is in, so partial progress survives
  // an abort (usage limit, timeout) instead of being lost with the run.
  onUpdate: Annotation<(update: TaskUpdate) => Promise<void>>,
  onProgress: Annotation<(done: number, total: number) => Promise<void>>,
  githubUsername: Annotation<string>,
  userStatuses: Annotation<UserStatus[]>,
  currentIndex: Annotation<number>,
  updates: Annotation<TaskUpdate[]>,
  errors: Annotation<string[]>,
});

type State = typeof GraphState.State;

// Anthropic API auth/quota failures plus the CLI backends' equivalents
// (see syncer/analyzers.ts): all mean every remaining task would fail too.
const FATAL_ERROR_RE =
  /\b401\b|authentication|invalid x-api-key|invalid_api_key|rate limit|^(claude|codex) (usage limit|not logged in)|Task write failed/i;

export const COMMENT_WINDOW = 8;
// Checks that fail until a reviewer acts (Expensify's checklist and
// independent-approval gates) are not the developer's to fix.
const REVIEWER_GATE_CHECK_RE = /independent approval|checklist|reviewer/i;
const DEPLOY_COMMENT_RE = /deployed to (production|staging)|🚀.*deploy/i;
const HELP_WANTED_RE = /help\s*-?\s*wanted/i;

function isBot(user: { login: string; type?: string }): boolean {
  return user.type === 'Bot' || /\[bot\]$|-bot$|^claude$/i.test(user.login);
}
const EVENT_WINDOW = 30;
// Timeline noise (mentioned, subscribed, renamed, ...) never changes a status.
const SIGNAL_EVENTS = new Set([
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
  'closed',
  'reopened',
  'referenced',
  'cross-referenced',
  'connected',
  'merged',
]);

async function fetchGithubData(state: State): Promise<Partial<State>> {
  const task = state.tasks[state.currentIndex];
  if (!task) return state;

  const parsed = parseIssueUrl(task.issue_url);
  if (!parsed) {
    return {
      errors: [...state.errors, `Could not parse issue URL: ${task.issue_url}`],
    };
  }

  try {
    const { owner, repo, number } = parsed;
    const token = state.githubToken;
    const username = state.githubUsername;
    const isFirstSync = !task.last_synced_at;

    // Fetch issue data, comments, and events in parallel
    const [issue, comments, events] = await Promise.all([
      fetchIssue(owner, repo, number, token),
      fetchIssueComments(owner, repo, number, token),
      fetchIssueEvents(owner, repo, number, token),
    ]);

    // Find or fetch linked PR
    let prData = null;
    let reviews = null;
    let discoveredPrUrl: string | null = null;

    if (task.pr_url) {
      // PR already known
      const prParsed = parsePrUrl(task.pr_url);
      if (prParsed) {
        [prData, reviews] = await Promise.all([
          fetchPR(prParsed.owner, prParsed.repo, prParsed.number, token),
          fetchPRReviews(prParsed.owner, prParsed.repo, prParsed.number, token),
        ]);
      }
    } else if (username) {
      // Try to discover linked PR by user
      const linkedPR = await findLinkedPR(owner, repo, number, username, token);
      if (linkedPR) {
        prData = linkedPR;
        discoveredPrUrl = linkedPR.html_url;
        reviews = await fetchPRReviews(owner, repo, linkedPR.number, token);
      }
    }

    // CI and merge state are what changes_required keys on; only an open,
    // unmerged PR needs them.
    // null = GitHub did not answer (403/404/5xx); the prompt must not read
    // that as "checks pass".
    let failingChecks: string[] | null = [];
    if (prData && prData.state === 'open' && !prData.merged) {
      const prParsed = parsePrUrl(prData.html_url);
      if (prParsed) {
        failingChecks =
          (
            await fetchFailingChecks(
              prParsed.owner,
              prParsed.repo,
              prData.head.sha,
              token
            )
          )?.filter((name) => !REVIEWER_GATE_CHECK_RE.test(name)) ?? null;
      }
    }

    // Find assignment date from events
    let assignedDate: string | null = null;
    if (username) {
      const assignEvent = events.find(
        (e) =>
          e.event === 'assigned' &&
          e.assignee?.login?.toLowerCase() === username.toLowerCase()
      );
      if (assignEvent) {
        assignedDate = assignEvent.created_at;
      }
    }

    // Detect if user manually edited the task since last sync
    const wasManuallyEdited =
      !!task.last_synced_at &&
      new Date(task.updated_at) > new Date(task.last_synced_at);

    const signalEvents = events.filter((e) => SIGNAL_EVENTS.has(e.event));

    // Bot reviews (Claude reviewers, melvin) never decide approved or
    // changes_required; only a human C+ does.
    const humanReviews = (reviews ?? []).filter((r) => !isBot(r.user));

    // The production-deploy comment starts the 7-day payment clock and is
    // often older than the last few comments, so keep it whatever its age.
    const recent = comments.slice(-COMMENT_WINDOW);
    const deployComments = comments.filter(
      (c) => !recent.includes(c) && DEPLOY_COMMENT_RE.test(c.body)
    );
    const promptComments = [...deployComments, ...recent];

    // Open issue handed to someone else: the bounty is lost even though
    // nothing closed. Computed here so the model does not have to infer it.
    // Expensify issues carry the BZ member and an internal engineer as
    // assignees from day one, so "assignees without me" alone means nothing.
    // The lost-bounty signal is Help Wanted having been removed again.
    const helpWantedRemoved =
      events.some(
        (e) =>
          e.event === 'unlabeled' && HELP_WANTED_RE.test(e.label?.name ?? '')
      ) && !issue.labels.some((l) => HELP_WANTED_RE.test(l.name));
    const assignedToOther =
      issue.state === 'open' &&
      !!username &&
      helpWantedRemoved &&
      issue.assignees.length > 0 &&
      !issue.assignees.some(
        (a) => a.login.toLowerCase() === username.toLowerCase()
      ) &&
      !prData;

    // Build analysis prompt with all context. Compact JSON: the model reads it
    // fine and it is roughly a third fewer tokens than pretty-printed.
    const analysisData = {
      currentStatus: task.status,
      isFirstSync,
      wasManuallyEdited,
      assignedToOther,
      githubUsername: username,
      issueTitle: issue.title,
      issueData: JSON.stringify({
        title: issue.title,
        state: issue.state,
        body: issue.body?.slice(0, 600) ?? null,
        assignees: issue.assignees.map((a) => a.login),
        labels: issue.labels.map((l) => l.name),
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
      }),
      prData: prData
        ? JSON.stringify({
            title: prData.title,
            state: prData.state,
            merged: prData.merged,
            merged_at: prData.merged_at,
            draft: prData.draft,
            review_comments: prData.review_comments,
            html_url: prData.html_url,
            user: prData.user.login,
            created_at: prData.created_at,
            updated_at: prData.updated_at,
            merge_conflicts: prData.mergeable_state === 'dirty',
            failing_checks: failingChecks,
          })
        : undefined,
      comments: promptComments.length
        ? JSON.stringify(
            promptComments.map((c) => ({
              user: c.user.login,
              body: c.body.slice(0, 500),
              created_at: c.created_at,
            }))
          )
        : undefined,
      reviews: humanReviews.length
        ? JSON.stringify(
            humanReviews.slice(-3).map((r) => ({
              user: r.user.login,
              state: r.state,
              body: r.body?.slice(0, 300),
              submitted_at: r.submitted_at,
            }))
          )
        : undefined,
      events: signalEvents.length
        ? JSON.stringify(
            signalEvents.slice(-EVENT_WINDOW).map((e) => ({
              event: e.event,
              actor: e.actor.login,
              created_at: e.created_at,
              assignee: e.assignee?.login,
            }))
          )
        : undefined,
      // Pre-extracted data for the AI to confirm or override
      existingPrUrl: task.pr_url,
      existingAssignedDate: task.assigned_date,
      existingAmount: task.amount,
      existingPaymentDate: task.payment_date,
      discoveredPrUrl,
      discoveredAssignedDate: assignedDate,
    };

    const prompt = buildAnalysisPrompt(analysisData);

    const content = await state.analyze(
      buildSystemPrompt(state.userStatuses),
      prompt
    );

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const update: TaskUpdate = {
        taskId: task.id,
        suggestedStatus: result.suggestedStatus,
        confidence: result.confidence,
        summary: result.summary,
        flags: result.flags || [],
        // Rich fields — AI decides what to populate
        issue_title: result.issue_title ?? undefined,
        pr_url: result.pr_url ?? discoveredPrUrl,
        assigned_date: result.assigned_date ?? assignedDate,
        payment_date: result.payment_date ?? undefined,
        amount: result.amount ?? undefined,
      };
      await state.onUpdate(update);
      return { updates: [...state.updates, update] };
    }

    return {
      errors: [
        ...state.errors,
        `Could not parse AI response for task ${task.id}`,
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect fatal config errors — no point processing more tasks
    if (FATAL_ERROR_RE.test(message)) {
      throw err;
    }

    return {
      errors: [...state.errors, `Error processing task ${task.id}: ${message}`],
    };
  }
}

async function advanceOrFinish(state: State): Promise<Partial<State>> {
  await state.onProgress(state.currentIndex + 1, state.tasks.length);
  return { currentIndex: state.currentIndex + 1 };
}

function shouldContinue(state: State): string {
  if (state.currentIndex + 1 < state.tasks.length) {
    return 'fetchGithubData';
  }
  return END;
}

export function createSyncGraph() {
  const graph = new StateGraph(GraphState)
    .addNode('fetchGithubData', fetchGithubData)
    .addNode('advanceOrFinish', advanceOrFinish)
    .addEdge('__start__', 'fetchGithubData')
    .addEdge('fetchGithubData', 'advanceOrFinish')
    .addConditionalEdges('advanceOrFinish', shouldContinue);

  return graph.compile();
}
