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
} from '@/lib/github';
import type { Bounty, BountyStatus } from '@/types/database';

export interface BountyUpdate {
  bountyId: string;
  suggestedStatus: BountyStatus;
  confidence: number;
  summary: string;
  flags: string[];
}

const GraphState = Annotation.Root({
  bounties: Annotation<Bounty[]>,
  githubToken: Annotation<string>,
  apiKey: Annotation<string>,
  currentIndex: Annotation<number>,
  updates: Annotation<BountyUpdate[]>,
  errors: Annotation<string[]>,
});

type State = typeof GraphState.State;

async function fetchGithubData(state: State): Promise<Partial<State>> {
  const bounty = state.bounties[state.currentIndex];
  if (!bounty) return state;

  const parsed = parseIssueUrl(bounty.issue_url);
  if (!parsed) {
    return {
      errors: [
        ...state.errors,
        `Could not parse issue URL: ${bounty.issue_url}`,
      ],
    };
  }

  try {
    const { owner, repo, number } = parsed;
    const token = state.githubToken;

    const [issue, comments, events] = await Promise.all([
      fetchIssue(owner, repo, number, token),
      fetchIssueComments(owner, repo, number, token),
      fetchIssueEvents(owner, repo, number, token),
    ]);

    let prData = null;
    let reviews = null;
    if (bounty.pr_url) {
      const prParsed = parsePrUrl(bounty.pr_url);
      if (prParsed) {
        [prData, reviews] = await Promise.all([
          fetchPR(prParsed.owner, prParsed.repo, prParsed.number, token),
          fetchPRReviews(prParsed.owner, prParsed.repo, prParsed.number, token),
        ]);
      }
    }

    // Build analysis prompt
    const analysisData = {
      currentStatus: bounty.status,
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
            },
            null,
            2
          )
        : undefined,
      comments: comments.length
        ? JSON.stringify(
            comments.slice(-20).map((c) => ({
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
            events.slice(-20).map((e) => ({
              event: e.event,
              actor: e.actor.login,
              created_at: e.created_at,
              assignee: e.assignee?.login,
            })),
            null,
            2
          )
        : undefined,
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
      const update: BountyUpdate = {
        bountyId: bounty.id,
        suggestedStatus: result.suggestedStatus,
        confidence: result.confidence,
        summary: result.summary,
        flags: result.flags || [],
      };
      return { updates: [...state.updates, update] };
    }

    return {
      errors: [...state.errors, `Could not parse AI response for bounty ${bounty.id}`],
    };
  } catch (err) {
    return {
      errors: [
        ...state.errors,
        `Error processing bounty ${bounty.id}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

async function advanceOrFinish(state: State): Promise<Partial<State>> {
  return { currentIndex: state.currentIndex + 1 };
}

function shouldContinue(state: State): string {
  if (state.currentIndex + 1 < state.bounties.length) {
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
