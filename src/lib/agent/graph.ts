import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT, buildAnalysisPrompt } from './prompts';
import {
  fetchIssue,
  fetchPR,
  fetchIssueComments,
  fetchPRReviews,
  fetchIssueEvents,
  parseIssueUrl,
  parsePrUrl,
  findLinkedPR,
} from '@/lib/github';
import type { Task, TaskStatus } from '@/types/database';

export interface TaskUpdate {
  taskId: string;
  suggestedStatus: TaskStatus;
  confidence: number;
  summary: string;
  flags: string[];
  // Rich fields the AI can populate
  pr_url?: string | null;
  note?: string | null;
  assigned_date?: string | null;
  payment_date?: string | null;
  amount?: number | null;
}

const GraphState = Annotation.Root({
  tasks: Annotation<Task[]>,
  githubToken: Annotation<string>,
  apiKey: Annotation<string>,
  githubUsername: Annotation<string>,
  currentIndex: Annotation<number>,
  updates: Annotation<TaskUpdate[]>,
  errors: Annotation<string[]>,
});

type State = typeof GraphState.State;

async function fetchGithubData(state: State): Promise<Partial<State>> {
  const task = state.tasks[state.currentIndex];
  if (!task) return state;

  const parsed = parseIssueUrl(task.issue_url);
  if (!parsed) {
    return {
      errors: [
        ...state.errors,
        `Could not parse issue URL: ${task.issue_url}`,
      ],
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

    // Build analysis prompt with all context
    const analysisData = {
      currentStatus: task.status,
      isFirstSync,
      githubUsername: username,
      issueTitle: issue.title,
      issueData: JSON.stringify(
        {
          title: issue.title,
          state: issue.state,
          assignees: issue.assignees.map((a) => a.login),
          labels: issue.labels.map((l) => l.name),
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          closed_at: issue.closed_at,
        },
        null,
        2
      ),
      prData: prData
        ? JSON.stringify(
            {
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
            },
            null,
            2
          )
        : undefined,
      comments: comments.length
        ? JSON.stringify(
            comments.slice(-30).map((c) => ({
              user: c.user.login,
              body: c.body.slice(0, 500),
              created_at: c.created_at,
            })),
            null,
            2
          )
        : undefined,
      reviews: reviews?.length
        ? JSON.stringify(
            reviews.map((r) => ({
              user: r.user.login,
              state: r.state,
              body: r.body?.slice(0, 300),
              submitted_at: r.submitted_at,
            })),
            null,
            2
          )
        : undefined,
      events: events.length
        ? JSON.stringify(
            events.slice(-30).map((e) => ({
              event: e.event,
              actor: e.actor.login,
              created_at: e.created_at,
              assignee: e.assignee?.login,
            })),
            null,
            2
          )
        : undefined,
      // Pre-extracted data for the AI to confirm or override
      existingPrUrl: task.pr_url,
      existingNote: task.note,
      existingAssignedDate: task.assigned_date,
      existingAmount: task.amount,
      existingPaymentDate: task.payment_date,
      discoveredPrUrl,
      discoveredAssignedDate: assignedDate,
    };

    const prompt = buildAnalysisPrompt(analysisData);

    // Call Claude
    const model = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      apiKey: state.apiKey,
      maxTokens: 1024,
    });

    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt),
    ]);

    const content =
      typeof response.content === 'string'
        ? response.content
        : response.content.map((c) => ('text' in c ? c.text : '')).join('');

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
        pr_url: result.pr_url ?? discoveredPrUrl,
        note: result.note ?? undefined,
        assigned_date: result.assigned_date ?? assignedDate,
        payment_date: result.payment_date ?? undefined,
        amount: result.amount ?? undefined,
      };
      return { updates: [...state.updates, update] };
    }

    return {
      errors: [...state.errors, `Could not parse AI response for task ${task.id}`],
    };
  } catch (err) {
    return {
      errors: [
        ...state.errors,
        `Error processing task ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

async function advanceOrFinish(state: State): Promise<Partial<State>> {
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
