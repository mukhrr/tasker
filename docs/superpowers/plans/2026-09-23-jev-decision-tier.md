# Jev Decision Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a calibrated decision tier (Jev, via Cloudflare Workers AI) in front of the existing Codex/Claude sync backends so unchanged tasks cost nothing and status comes from a calibrated Choice instead of the LLM's self-reported confidence.

**Architecture:** A second seam beside `Analyzer` — a `Decider` in `src/lib/agent/jev.ts` — called inside the existing `fetchGithubData` node. No new graph nodes, no new `ai_backend`, no DB migration. Date reasoning moves out of the prompt into pure TypeScript (`facts.ts`) because Jev cannot do date comparison. Three env-controlled modes: `off` (today's behaviour), `shadow` (Jev runs, LLM still decides), `on` (Jev decides, gate skips).

**Tech Stack:** TypeScript 5, Next.js 16 App Router, LangGraph.js, Vitest (added in Task 1), Cloudflare Workers AI REST.

**Spec:** `docs/superpowers/specs/2026-09-22-jev-decision-tier-design.md`

## Global Constraints

- **Fail-soft, always.** Any Jev failure — timeout, non-200, malformed answer, missing key — falls back to the current LLM path for that task. Jev errors must never reach `FATAL_ERROR_RE` in `src/lib/agent/graph.ts` and never fail a run.
- **`off` is byte-for-byte today's behaviour.** With no `CLOUDFLARE_AI_TOKEN`, or `JEV_MODE` unset, nothing about the sync changes.
- **No DB migration.** `sync_logs.details` is already `jsonb`.
- **Both runtimes.** Everything added runs on Vercel (API-key users) and on the Railway worker (CLI users). Plain `fetch` only — no Node-only APIs in `src/lib/agent/`.
- **The runner's decision logic does not change.** Thresholds stay `confidence >= 0.6` (fields) and `>= 0.75` (status change); `userSetStatus`, `isManualStatus`, `statusChanges` and the archived-task filter keep working on a `TaskUpdate` they cannot tell apart from today's.
- **Model id:** `typesafe/jev`. **Endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/typesafe/jev`.
- **Max 255 Choice options.** The user has 14.
- **Never ask Jev about dates.** Every date comparison is precomputed in `facts.ts` and passed as an answer.
- Comment style per `~/.claude/CLAUDE.md`: comment only what the code cannot say, one or two sentences, no banners.

---

### Task 1: Test harness

The project has no test framework (`CLAUDE.md`: "No test framework is configured yet"). Tasks 2-6 are pure date and string logic where a silent off-by-one is the likely failure, and `tsc`/`eslint` cannot catch that. Vitest is the smallest thing that runs TypeScript with the `@/*` alias.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts, devDependencies)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest once; `npm run test:watch` watches. Test files are `src/**/*.test.ts`, importing `{ describe, it, expect }` from `vitest` explicitly (no globals, so `tsconfig.json` needs no `types` entry).

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest@^3 --no-audit --no-fund
```

- [ ] **Step 2: Create the config**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add the scripts**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Prove the harness runs**

Create `src/lib/agent/harness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: Delete the placeholder and verify the typecheck still passes**

```bash
rm src/lib/agent/harness.test.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Add Vitest for the agent's pure logic"
```

---

### Task 2: Precomputed facts module

Pure functions only. No network, no Supabase. `now` is a parameter so tests are deterministic.

**Files:**
- Create: `src/lib/agent/facts.ts`
- Create: `src/lib/agent/facts.test.ts`

**Interfaces:**
- Consumes: `GitHubComment`, `GitHubPullRequest`, `GitHubReview` from `@/types/github`.
- Produces:
  - `DEPLOY_COMMENT_RE: RegExp` — broad, matches production *or* staging deploy comments; `graph.ts` uses it to keep deploy comments in the prompt window.
  - `PRODUCTION_DEPLOY_RE: RegExp` — narrow, production only; starts the payment clock.
  - `PAYMENT_DELAY_DAYS: number` (7).
  - `interface TaskFacts` with the nine fields below.
  - `computeTaskFacts(input: TaskFactsInput, now: Date): TaskFacts`.
  - `interface TaskFactsInput { comments, pr, humanReviews, assignedDate, issueUpdatedAt }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/agent/facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeTaskFacts, PRODUCTION_DEPLOY_RE, DEPLOY_COMMENT_RE } from './facts';
import type { GitHubComment, GitHubPullRequest, GitHubReview } from '@/types/github';

const NOW = new Date('2026-09-23T12:00:00Z');

function comment(body: string, created_at: string): GitHubComment {
  return { id: 1, user: { login: 'bot', id: 1, avatar_url: '' }, body, created_at };
}

function review(state: GitHubReview['state'], submitted_at: string): GitHubReview {
  return { id: 1, user: { login: 'cplus', id: 2, avatar_url: '' }, state, body: null, submitted_at };
}

const pr = (over: Partial<GitHubPullRequest> = {}) =>
  ({
    number: 1, title: 't', state: 'open', html_url: 'u',
    user: { login: 'mukhrr', id: 3, avatar_url: '' },
    merged: false, merged_at: null, draft: false, review_comments: 0,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
    closed_at: null, body: null, head: { sha: 'abc' },
    mergeable: true, mergeable_state: 'clean',
    ...over,
  }) as GitHubPullRequest;

const empty = { comments: [], pr: null, humanReviews: [], assignedDate: null, issueUpdatedAt: null };

describe('regexes', () => {
  it('counts only production for the payment clock', () => {
    expect(PRODUCTION_DEPLOY_RE.test('Deployed to production in v1.2.3')).toBe(true);
    expect(PRODUCTION_DEPLOY_RE.test('Deployed to staging in v1.2.3')).toBe(false);
    expect(DEPLOY_COMMENT_RE.test('Deployed to staging in v1.2.3')).toBe(true);
  });
});

describe('computeTaskFacts', () => {
  it('returns all-null for an empty task', () => {
    const f = computeTaskFacts(empty, NOW);
    expect(f.production_deploy_at).toBeNull();
    expect(f.days_since_production_deploy).toBeNull();
    expect(f.payment_due_at).toBeNull();
    expect(f.pushed_after_changes_requested).toBeNull();
    expect(f.latest_human_review_state).toBeNull();
  });

  it('dates the payment clock from the newest production deploy comment', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        comments: [
          comment('Deployed to production 🚀', '2026-09-01T00:00:00Z'),
          comment('Deployed to production again', '2026-09-09T12:00:00Z'),
          comment('Deployed to staging', '2026-09-20T00:00:00Z'),
        ],
      },
      NOW
    );
    expect(f.production_deploy_at).toBe('2026-09-09T12:00:00Z');
    expect(f.days_since_production_deploy).toBe(14);
    expect(f.payment_due_at).toBe('2026-09-16T12:00:00.000Z');
    expect(f.payment_overdue_days).toBe(7);
  });

  it('reports a payment not yet due as negative overdue days', () => {
    const f = computeTaskFacts(
      { ...empty, comments: [comment('Deployed to production', '2026-09-21T12:00:00Z')] },
      NOW
    );
    expect(f.days_since_production_deploy).toBe(2);
    expect(f.payment_overdue_days).toBe(-5);
  });

  it('says the developer pushed after changes were requested', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr({ updated_at: '2026-09-22T00:00:00Z' }),
        humanReviews: [review('CHANGES_REQUESTED', '2026-09-21T00:00:00Z')],
      },
      NOW
    );
    expect(f.pushed_after_changes_requested).toBe(true);
    expect(f.latest_human_review_state).toBe('CHANGES_REQUESTED');
  });

  it('says the developer has not pushed since the request', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr({ updated_at: '2026-09-20T00:00:00Z' }),
        humanReviews: [review('CHANGES_REQUESTED', '2026-09-21T00:00:00Z')],
      },
      NOW
    );
    expect(f.pushed_after_changes_requested).toBe(false);
  });

  it('uses the newest review for both facts', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr(),
        humanReviews: [
          review('CHANGES_REQUESTED', '2026-09-10T00:00:00Z'),
          review('APPROVED', '2026-09-19T00:00:00Z'),
        ],
      },
      NOW
    );
    expect(f.latest_human_review_state).toBe('APPROVED');
    expect(f.pushed_after_changes_requested).toBe(true);
  });

  it('counts days since merge and assignment', () => {
    const f = computeTaskFacts(
      {
        ...empty,
        pr: pr({ merged: true, merged_at: '2026-09-13T12:00:00Z' }),
        assignedDate: '2026-09-03T12:00:00Z',
      },
      NOW
    );
    expect(f.days_since_merge).toBe(10);
    expect(f.days_since_assigned).toBe(20);
  });

  it('ignores unparsable dates instead of returning NaN', () => {
    const f = computeTaskFacts({ ...empty, assignedDate: 'not-a-date' }, NOW);
    expect(f.days_since_assigned).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./facts"`.

- [ ] **Step 3: Write the implementation**

`src/lib/agent/facts.ts`:

```ts
import type {
  GitHubComment,
  GitHubPullRequest,
  GitHubReview,
} from '@/types/github';

// Broad: keeps any deploy comment inside the prompt window.
export const DEPLOY_COMMENT_RE = /deployed to (production|staging)|🚀.*deploy/i;
// Narrow: only a production deploy starts Expensify's payment clock.
export const PRODUCTION_DEPLOY_RE = /deployed to production/i;
export const PAYMENT_DELAY_DAYS = 7;

const DAY_MS = 86_400_000;

export interface TaskFacts {
  production_deploy_at: string | null;
  days_since_production_deploy: number | null;
  payment_due_at: string | null;
  payment_overdue_days: number | null;
  pushed_after_changes_requested: boolean | null;
  latest_human_review_state: GitHubReview['state'] | null;
  days_since_merge: number | null;
  days_since_assigned: number | null;
  days_since_last_activity: number | null;
}

export interface TaskFactsInput {
  comments: GitHubComment[];
  pr: GitHubPullRequest | null;
  humanReviews: GitHubReview[];
  assignedDate: string | null;
  issueUpdatedAt: string | null;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  const t = time(iso);
  return t === null ? null : Math.floor((now.getTime() - t) / DAY_MS);
}

function newest<T>(items: T[], at: (item: T) => string | null): T | null {
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const item of items) {
    const t = time(at(item));
    if (t !== null && t >= bestAt) {
      best = item;
      bestAt = t;
    }
  }
  return best;
}

export function computeTaskFacts(
  input: TaskFactsInput,
  now: Date
): TaskFacts {
  const deploy = newest(
    input.comments.filter((c) => PRODUCTION_DEPLOY_RE.test(c.body)),
    (c) => c.created_at
  );
  const deployAt = time(deploy?.created_at);
  const dueAt =
    deployAt === null ? null : new Date(deployAt + PAYMENT_DELAY_DAYS * DAY_MS);

  const latestReview = newest(input.humanReviews, (r) => r.submitted_at);
  const latestChangesRequested = newest(
    input.humanReviews.filter((r) => r.state === 'CHANGES_REQUESTED'),
    (r) => r.submitted_at
  );

  // updated_at is the closest signal to "pushed" without another API call:
  // it moves on a push, and also on edits the developer made anyway.
  const prUpdated = time(input.pr?.updated_at);
  const requestedAt = time(latestChangesRequested?.submitted_at);

  return {
    production_deploy_at: deploy?.created_at ?? null,
    days_since_production_deploy: daysSince(deploy?.created_at, now),
    payment_due_at: dueAt?.toISOString() ?? null,
    payment_overdue_days:
      dueAt === null
        ? null
        : Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS),
    pushed_after_changes_requested:
      prUpdated === null || requestedAt === null ? null : prUpdated > requestedAt,
    latest_human_review_state: latestReview?.state ?? null,
    days_since_merge: daysSince(input.pr?.merged_at, now),
    days_since_assigned: daysSince(input.assignedDate, now),
    days_since_last_activity: daysSince(input.issueUpdatedAt, now),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/facts.ts src/lib/agent/facts.test.ts
git commit -m "Compute the sync agent's date facts in TypeScript"
```

---

### Task 3: Phase 0 — use the facts in the prompt

Replaces date reasoning in the prompt with computed answers. Ships value with no Jev involved: `awaiting_payment` and `changes_required` stop depending on the model reading dates.

**Files:**
- Modify: `src/lib/agent/graph.ts` (remove local `DEPLOY_COMMENT_RE`, import from `facts`, compute facts, pass them through)
- Modify: `src/lib/agent/prompts.ts` (`buildAnalysisPrompt` accepts `facts`; rules reference the facts)

**Interfaces:**
- Consumes: `computeTaskFacts`, `DEPLOY_COMMENT_RE`, `TaskFacts` from Task 2.
- Produces: `buildAnalysisPrompt` accepts an optional `facts?: TaskFacts` field and renders it as a `## Computed Facts` block. `graph.ts` holds a `facts` const available to Task 7.

- [ ] **Step 1: Move the regex**

In `src/lib/agent/graph.ts`, delete the line:

```ts
const DEPLOY_COMMENT_RE = /deployed to (production|staging)|🚀.*deploy/i;
```

and add `DEPLOY_COMMENT_RE` plus `computeTaskFacts` to the imports:

```ts
import { computeTaskFacts, DEPLOY_COMMENT_RE } from './facts';
```

- [ ] **Step 2: Compute the facts in the node**

In `fetchGithubData`, immediately after the `assignedToOther` block and before `const analysisData = {`:

```ts
    const facts = computeTaskFacts(
      {
        comments,
        pr: prData,
        humanReviews,
        assignedDate,
        issueUpdatedAt: issue.updated_at,
      },
      new Date()
    );
```

- [ ] **Step 3: Pass the facts into the prompt**

In the same function, add `facts` to the `analysisData` object literal, directly after `wasManuallyEdited`:

```ts
      facts,
```

- [ ] **Step 4: Render the facts in the prompt**

In `src/lib/agent/prompts.ts`, add to the `buildAnalysisPrompt` parameter type (after `assignedToOther?: boolean;`):

```ts
  facts?: TaskFacts;
```

Add the import at the top:

```ts
import type { TaskFacts } from './facts';
```

And render it — insert directly before the `if (data.issueData) {` block:

```ts
  if (data.facts) {
    const known = Object.entries(data.facts).filter(([, v]) => v !== null);
    if (known.length) {
      prompt += `## Computed Facts\nThese are computed from the data below, not guesses. Trust them over your own reading of dates.\n${JSON.stringify(
        Object.fromEntries(known)
      )}\n\n`;
    }
  }
```

- [ ] **Step 5: Point the rules at the facts**

In `src/lib/agent/prompts.ts`, inside `statusRules`, replace the `awaiting_payment` rule body with:

```ts
    rules.push(`**awaiting_payment**: the PR is merged AND \`payment_overdue_days\` is present and >= 0 (payment is due 7 days after the production deploy). Merged with no production deploy, or \`payment_overdue_days\` below 0, stays **merged**.`);
```

and the numbered clause 2 of the `changes_required` rule with:

```ts
2. \`latest_human_review_state\` is CHANGES_REQUESTED and \`pushed_after_changes_requested\` is false
```

- [ ] **Step 6: Update the payment_date instruction**

In `buildSystemPrompt`, replace the `payment_date` paragraph with:

```ts
payment_date: if a comment states an actual payment date, use it. Otherwise use \`payment_due_at\` from Computed Facts when it is present. Otherwise null. Never calculate a date yourself.
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc -p tsconfig.syncer.json && npm test && npm run lint
```

Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agent/graph.ts src/lib/agent/prompts.ts
git commit -m "Hand the model computed date facts instead of asking it to compare dates"
```

---

### Task 4: Jev client

**Files:**
- Create: `src/lib/agent/jev.ts`
- Create: `src/lib/agent/jev.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type JevMode = 'off' | 'shadow' | 'on'`
  - `type JevQuestion = { type: 'noul'; instructions: string } | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }`
  - `interface JevChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }`
  - `interface JevNoulAnswer { type: 'noul'; noul: number }`
  - `type JevAnswer = JevChoiceAnswer | JevNoulAnswer`
  - `type Decider = (state: unknown, questions: Record<string, JevQuestion>) => Promise<Record<string, JevAnswer> | null>` — resolves `null` on **any** failure, never throws.
  - `cloudflareJevDecider(accountId: string, token: string, opts?: { timeoutMs?: number; fetchImpl?: typeof fetch }): Decider`
  - `jevModeFromEnv(env?: NodeJS.ProcessEnv): JevMode`
  - `deciderFromEnv(env?: NodeJS.ProcessEnv): Decider | null`

**Note for the implementer:** the exact Cloudflare Workers AI response envelope for `typesafe/jev` has not been confirmed against a live call. The parser therefore accepts both `{ result: { answers } }` and a bare `{ answers }`, and returns `null` on anything else. Confirm against one real call before Task 7 is enabled in `shadow`.

- [ ] **Step 1: Write the failing tests**

`src/lib/agent/jev.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { cloudflareJevDecider, jevModeFromEnv, deciderFromEnv } from './jev';

const QUESTIONS = {
  status: {
    type: 'choice' as const,
    instructions: 'Pick the status',
    criteria: { reviewing: 'PR open', merged: 'PR merged' },
  },
};

function okResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status: 200 }) as Response
  );
}

describe('jevModeFromEnv', () => {
  it('defaults to off', () => {
    expect(jevModeFromEnv({})).toBe('off');
  });

  it('reads a valid mode', () => {
    expect(jevModeFromEnv({ JEV_MODE: 'shadow' })).toBe('shadow');
    expect(jevModeFromEnv({ JEV_MODE: 'on' })).toBe('on');
  });

  it('treats an unknown value as off', () => {
    expect(jevModeFromEnv({ JEV_MODE: 'yes please' })).toBe('off');
  });
});

describe('deciderFromEnv', () => {
  it('is null without credentials', () => {
    expect(deciderFromEnv({ JEV_MODE: 'on' })).toBeNull();
  });

  it('builds a decider when both credentials exist', () => {
    const d = deciderFromEnv({
      JEV_MODE: 'on',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_AI_TOKEN: 'tok',
    });
    expect(typeof d).toBe('function');
  });
});

describe('cloudflareJevDecider', () => {
  it('posts to the account endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn(() =>
      okResponse({ result: { answers: { status: { type: 'choice', choice: 'merged', probabilities: { merged: 0.9 }, confidence: 0.8 } } } })
    );
    const decide = cloudflareJevDecider('acc123', 'tok456', { fetchImpl: fetchImpl as unknown as typeof fetch });

    const answers = await decide({ hello: 'world' }, QUESTIONS);

    expect(answers?.status).toEqual({
      type: 'choice', choice: 'merged', probabilities: { merged: 0.9 }, confidence: 0.8,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/typesafe/jev');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok456');
    expect(JSON.parse(init.body as string)).toEqual({ state: { hello: 'world' }, questions: QUESTIONS });
  });

  it('accepts a bare answers envelope', async () => {
    const fetchImpl = vi.fn(() =>
      okResponse({ answers: { status: { type: 'choice', choice: 'reviewing', probabilities: {}, confidence: 0.5 } } })
    );
    const decide = cloudflareJevDecider('a', 'b', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const answers = await decide({}, QUESTIONS);
    expect(answers?.status.type).toBe('choice');
  });

  it('returns null on a non-200', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('nope', { status: 500 })));
    const decide = cloudflareJevDecider('a', 'b', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });

  it('returns null when the body has no answers', async () => {
    const fetchImpl = vi.fn(() => okResponse({ result: {} }));
    const decide = cloudflareJevDecider('a', 'b', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });

  it('returns null instead of throwing when fetch rejects', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('socket hang up')));
    const decide = cloudflareJevDecider('a', 'b', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await decide({}, QUESTIONS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./jev"`.

- [ ] **Step 3: Write the implementation**

`src/lib/agent/jev.ts`:

```ts
// Jev decides; it cannot generate. The Analyzer seam in llm.ts still owns
// every word the user reads. Reached through Cloudflare Workers AI because
// TypeSafe's own access is waitlisted.
export type JevMode = 'off' | 'shadow' | 'on';

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string | null>;
    };

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

// Resolves null on every failure. Callers fall back to the LLM path; a
// broken accelerator must never fail a sync.
export type Decider = (
  state: unknown,
  questions: Record<string, JevQuestion>
) => Promise<Record<string, JevAnswer> | null>;

const MODEL = 'typesafe/jev';
const DEFAULT_TIMEOUT_MS = 5000;

function answersFrom(body: unknown): Record<string, JevAnswer> | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as { result?: { answers?: unknown }; answers?: unknown };
  const answers = envelope.result?.answers ?? envelope.answers;
  if (!answers || typeof answers !== 'object') return null;
  return answers as Record<string, JevAnswer>;
}

export function cloudflareJevDecider(
  accountId: string,
  token: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Decider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

  return async (state, questions) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state, questions }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return answersFrom(await res.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function jevModeFromEnv(env: NodeJS.ProcessEnv = process.env): JevMode {
  const mode = env.JEV_MODE;
  return mode === 'shadow' || mode === 'on' ? mode : 'off';
}

export function deciderFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Decider | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_AI_TOKEN;
  if (!accountId || !token) return null;
  return cloudflareJevDecider(accountId, token);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Document the env vars**

Append to `.env.example`:

```
# Jev decision tier (optional; off when unset)
# JEV_MODE = off | shadow | on
JEV_MODE=off
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_AI_TOKEN=
JEV_GATE_THRESHOLD=0.3
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/jev.ts src/lib/agent/jev.test.ts .env.example
git commit -m "Add the Jev decider client over Cloudflare Workers AI"
```

---

### Task 5: Deterministic change gate

Stage 1 of the gate: free, exact, no model. A task is analysed unless nothing has happened since its last sync.

**Files:**
- Create: `src/lib/agent/gate.ts`
- Create: `src/lib/agent/gate.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `hasChangedSince(input: ChangeInput): boolean` and `interface ChangeInput { lastSyncedAt: string | null; userEdited: boolean; issueUpdatedAt: string | null; prUpdatedAt: string | null; commentDates: string[]; eventDates: string[] }`. `true` means "must analyse".

- [ ] **Step 1: Write the failing tests**

`src/lib/agent/gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasChangedSince } from './gate';

const base = {
  lastSyncedAt: '2026-09-20T00:00:00Z',
  userEdited: false,
  issueUpdatedAt: '2026-09-19T00:00:00Z',
  prUpdatedAt: null,
  commentDates: [],
  eventDates: [],
};

describe('hasChangedSince', () => {
  it('always analyses a task that has never synced', () => {
    expect(hasChangedSince({ ...base, lastSyncedAt: null })).toBe(true);
  });

  it('always analyses a task the user edited by hand', () => {
    expect(hasChangedSince({ ...base, userEdited: true })).toBe(true);
  });

  it('skips when nothing is newer than the last sync', () => {
    expect(hasChangedSince(base)).toBe(false);
  });

  it('analyses when the issue moved', () => {
    expect(hasChangedSince({ ...base, issueUpdatedAt: '2026-09-21T00:00:00Z' })).toBe(true);
  });

  it('analyses when the PR moved', () => {
    expect(hasChangedSince({ ...base, prUpdatedAt: '2026-09-21T00:00:00Z' })).toBe(true);
  });

  it('analyses on a new comment', () => {
    expect(
      hasChangedSince({ ...base, commentDates: ['2026-09-01T00:00:00Z', '2026-09-22T00:00:00Z'] })
    ).toBe(true);
  });

  it('analyses on a new event', () => {
    expect(hasChangedSince({ ...base, eventDates: ['2026-09-22T00:00:00Z'] })).toBe(true);
  });

  it('ignores comments and events older than the last sync', () => {
    expect(
      hasChangedSince({
        ...base,
        commentDates: ['2026-09-01T00:00:00Z'],
        eventDates: ['2026-09-02T00:00:00Z'],
      })
    ).toBe(false);
  });

  it('analyses when a date is unparsable rather than assuming nothing changed', () => {
    expect(hasChangedSince({ ...base, commentDates: ['whenever'] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./gate"`.

- [ ] **Step 3: Write the implementation**

`src/lib/agent/gate.ts`:

```ts
export interface ChangeInput {
  lastSyncedAt: string | null;
  userEdited: boolean;
  issueUpdatedAt: string | null;
  prUpdatedAt: string | null;
  commentDates: string[];
  eventDates: string[];
}

// True means "must analyse". Everything unknown counts as changed: a skip
// has to be provably safe, and an unnecessary analysis only costs money.
export function hasChangedSince(input: ChangeInput): boolean {
  if (!input.lastSyncedAt || input.userEdited) return true;
  const since = new Date(input.lastSyncedAt).getTime();
  if (Number.isNaN(since)) return true;

  const candidates = [
    input.issueUpdatedAt,
    input.prUpdatedAt,
    ...input.commentDates,
    ...input.eventDates,
  ];

  return candidates.some((iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) || t > since;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/gate.ts src/lib/agent/gate.test.ts
git commit -m "Add the deterministic half of the sync change gate"
```

---

### Task 6: Jev question builders

Turns the user's status taxonomy into a Choice, and the material-change judgement into a Noul.

**Files:**
- Create: `src/lib/agent/questions.ts`
- Create: `src/lib/agent/questions.test.ts`

**Interfaces:**
- Consumes: `JevQuestion` from Task 4 (`./jev`), `UserStatus` from `@/types/database`.
- Produces:
  - `statusCriteria(statuses: UserStatus[]): Record<string, string | null>`
  - `statusChoiceQuestion(statuses: UserStatus[]): JevQuestion`
  - `materialChangeQuestion(): JevQuestion`
  - `statusesMissingDescriptions(statuses: UserStatus[]): string[]`
  - `MAX_CHOICE_OPTIONS = 255`

- [ ] **Step 1: Write the failing tests**

`src/lib/agent/questions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  statusCriteria,
  statusChoiceQuestion,
  materialChangeQuestion,
  statusesMissingDescriptions,
  MAX_CHOICE_OPTIONS,
} from './questions';
import type { UserStatus } from '@/types/database';

function status(key: string, description: string, group: UserStatus['group_name'] = 'todo'): UserStatus {
  return {
    id: key, user_id: 'u', key, label: key, description,
    color: 'gray', group_name: group, position: 0, created_at: '',
  };
}

describe('statusCriteria', () => {
  it('maps each status key to its description', () => {
    expect(statusCriteria([status('merged', 'PR has been merged')])).toEqual({
      merged: 'PR has been merged',
    });
  });

  it('sends null for a status with no description', () => {
    expect(statusCriteria([status('hold', '')])).toEqual({ hold: null });
  });

  it('caps the option count at the API maximum', () => {
    const many = Array.from({ length: MAX_CHOICE_OPTIONS + 10 }, (_, i) => status(`s${i}`, 'd'));
    expect(Object.keys(statusCriteria(many))).toHaveLength(MAX_CHOICE_OPTIONS);
  });
});

describe('statusesMissingDescriptions', () => {
  it('names the statuses that would be sent as null', () => {
    expect(
      statusesMissingDescriptions([status('merged', 'PR merged'), status('hold', '  ')])
    ).toEqual(['hold']);
  });
});

describe('statusChoiceQuestion', () => {
  it('builds a choice carrying the criteria', () => {
    const q = statusChoiceQuestion([status('merged', 'PR has been merged')]);
    expect(q.type).toBe('choice');
    if (q.type !== 'choice') throw new Error('expected a choice');
    expect(q.criteria).toEqual({ merged: 'PR has been merged' });
    expect(q.instructions).toContain('status');
  });
});

describe('materialChangeQuestion', () => {
  it('is a noul', () => {
    expect(materialChangeQuestion().type).toBe('noul');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./questions"`.

- [ ] **Step 3: Write the implementation**

`src/lib/agent/questions.ts`:

```ts
import type { JevQuestion } from './jev';
import type { UserStatus } from '@/types/database';

export const MAX_CHOICE_OPTIONS = 255;

export function statusCriteria(
  statuses: UserStatus[]
): Record<string, string | null> {
  const criteria: Record<string, string | null> = {};
  for (const status of statuses.slice(0, MAX_CHOICE_OPTIONS)) {
    const description = status.description?.trim();
    criteria[status.key] = description ? description : null;
  }
  return criteria;
}

// A null criterion is legal but guesses; Settings should make descriptions
// mandatory, and until then the caller logs these.
export function statusesMissingDescriptions(statuses: UserStatus[]): string[] {
  return statuses
    .filter((s) => !s.description?.trim())
    .map((s) => s.key);
}

export function statusChoiceQuestion(statuses: UserStatus[]): JevQuestion {
  return {
    type: 'choice',
    instructions:
      'Pick the status that matches this task now. Each option describes when it applies. Use the Computed Facts as given; do not re-derive them.',
    criteria: statusCriteria(statuses),
  };
}

export function materialChangeQuestion(): JevQuestion {
  return {
    type: 'noul',
    instructions:
      'Could anything listed here change the task status, the pull request, the bounty amount, or the payment state? Routine bot comments, reminders and label churn are not changes.',
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/questions.ts src/lib/agent/questions.test.ts
git commit -m "Build Jev's status Choice from the user's own taxonomy"
```

---

### Task 7: Shadow mode

Jev runs for real; the LLM still decides everything and nothing is skipped. This is what generates the comparison data that earns `on`.

**Files:**
- Modify: `src/lib/agent/graph.ts` (state annotations, gate + Jev call, observation callback)
- Modify: `src/lib/agent/runner.ts` (wire the decider, collect observations, write `details.jev`)

**Interfaces:**
- Consumes: `Decider`, `JevMode`, `JevChoiceAnswer`, `JevNoulAnswer`, `deciderFromEnv`, `jevModeFromEnv` (Task 4); `hasChangedSince` (Task 5); `statusChoiceQuestion`, `materialChangeQuestion`, `statusesMissingDescriptions` (Task 6); `computeTaskFacts` (Task 2).
- Produces:
  - `interface JevObservation { taskId: string; deterministicChanged: boolean; noul: number | null; choice: string | null; probabilities: Record<string, number> | null; confidence: number | null; llmStatus: string | null; llmConfidence: number | null; agree: boolean | null; latencyMs: number | null; error: string | null }` exported from `src/lib/agent/graph.ts`.
  - `GraphState` gains `decide`, `jevMode`, `gateThreshold`, `onJev`, `skipped`.
  - `runSync` writes `details.jev` on the sync log.

- [ ] **Step 1: Add the state annotations**

In `src/lib/agent/graph.ts`, add to `GraphState`, after `onProgress`:

```ts
  decide: Annotation<Decider | null>,
  jevMode: Annotation<JevMode>,
  gateThreshold: Annotation<number>,
  onJev: Annotation<(observation: JevObservation) => void>,
  skipped: Annotation<string[]>,
```

Add the imports:

```ts
import type { Decider, JevChoiceAnswer, JevMode, JevNoulAnswer } from './jev';
import { hasChangedSince } from './gate';
import {
  materialChangeQuestion,
  statusChoiceQuestion,
  statusesMissingDescriptions,
} from './questions';
```

And export the observation type next to `TaskUpdate`:

```ts
export interface JevObservation {
  taskId: string;
  deterministicChanged: boolean;
  noul: number | null;
  choice: string | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  llmStatus: string | null;
  llmConfidence: number | null;
  agree: boolean | null;
  latencyMs: number | null;
  error: string | null;
}
```

- [ ] **Step 2: Run the gate and Jev before the analyzer**

First, declare the observation **above** the `try` block (the `catch` needs it), directly after
`const isFirstSync = !task.last_synced_at;`:

```ts
  let observation: JevObservation | null = null;
```

Then, inside `fetchGithubData`, insert directly after the `const facts = computeTaskFacts(...)` block from Task 3:

```ts
    const deterministicChanged = hasChangedSince({
      lastSyncedAt: task.last_synced_at,
      userEdited: wasManuallyEdited,
      issueUpdatedAt: issue.updated_at,
      prUpdatedAt: prData?.updated_at ?? null,
      commentDates: comments.map((c) => c.created_at),
      eventDates: signalEvents.map((e) => e.created_at),
    });

    observation = {
      taskId: task.id,
      deterministicChanged,
      noul: null,
      choice: null,
      probabilities: null,
      confidence: null,
      llmStatus: null,
      llmConfidence: null,
      agree: null,
      latencyMs: null,
      error: null,
    };

    let jevChoice: JevChoiceAnswer | null = null;

    if (state.jevMode !== 'off' && state.decide) {
      const missing = statusesMissingDescriptions(state.userStatuses);
      if (missing.length) {
        console.warn(
          `[jev] statuses without descriptions will be guessed: ${missing.join(', ')}`
        );
      }
      const startedAt = Date.now();
      const answers = await state.decide(
        { currentStatus: task.status, facts, issue: analysisSummary(issue, prData) },
        {
          material: materialChangeQuestion(),
          status: statusChoiceQuestion(state.userStatuses),
        }
      );
      observation.latencyMs = Date.now() - startedAt;
      if (!answers) {
        observation.error = 'jev unavailable';
      } else {
        const material = answers.material as JevNoulAnswer | undefined;
        const status = answers.status as JevChoiceAnswer | undefined;
        observation.noul = material?.noul ?? null;
        if (status?.type === 'choice') {
          jevChoice = status;
          observation.choice = status.choice;
          observation.probabilities = status.probabilities ?? null;
          observation.confidence = status.confidence ?? null;
        }
      }
    }
```

- [ ] **Step 3: Add the state summary helper**

Still in `src/lib/agent/graph.ts`, above `fetchGithubData`:

```ts
// Jev degrades on large states full of irrelevant detail, so it sees a
// digest rather than the full prompt the LLM gets.
function analysisSummary(
  issue: GitHubIssue,
  prData: GitHubPullRequest | null
): Record<string, unknown> {
  return {
    issue_state: issue.state,
    labels: issue.labels.map((l) => l.name),
    assignees: issue.assignees.map((a) => a.login),
    pr_state: prData ? prData.state : null,
    pr_merged: prData ? prData.merged : null,
    pr_draft: prData ? prData.draft : null,
  };
}
```

and add the types to the existing `@/types/github` import line:

```ts
import type { GitHubIssue, GitHubPullRequest } from '@/types/github';
```

- [ ] **Step 4: Record the observation after the LLM answers**

In the same function, inside the `if (jsonMatch) {` branch, directly after `const update: TaskUpdate = { ... };` and before `await state.onUpdate(update);`:

```ts
      if (state.jevMode !== 'off' && observation) {
        observation.llmStatus = update.suggestedStatus;
        observation.llmConfidence = update.confidence;
        observation.agree =
          observation.choice === null
            ? null
            : observation.choice === update.suggestedStatus;
        state.onJev(observation);
      }
```

And in the `catch` block, before the `FATAL_ERROR_RE` check:

```ts
    if (state.jevMode !== 'off' && observation) {
      observation.error = observation.error ?? message;
      state.onJev(observation);
    }
```

- [ ] **Step 5: Wire the decider in the runner**

In `src/lib/agent/runner.ts`, add the imports:

```ts
import { deciderFromEnv, jevModeFromEnv } from './jev';
import type { JevObservation } from './graph';
```

Above the `try` that invokes the graph, next to `statusChanges`:

```ts
  const jevObservations: JevObservation[] = [];
```

Next to it, build the decider once — `deciderFromEnv()` creates a closure, so calling it twice
would make two:

```ts
  const decide = deciderFromEnv();
```

In the `graph.invoke({ ... })` object, after `onProgress`:

```ts
        decide,
        jevMode: decide ? jevModeFromEnv() : 'off',
        gateThreshold: Number(process.env.JEV_GATE_THRESHOLD ?? 0.3),
        onJev: (observation) => jevObservations.push(observation),
        skipped: [],
```

- [ ] **Step 6: Write the observations to the sync log**

In `runner.ts`, add `jev: jevObservations` to the `details` object of **both** the success update and the failure update, e.g.:

```ts
          details: {
            updates: result.updates,
            errors: result.errors,
            statusChanges,
            progress: { done: tasks.length, total: tasks.length },
            jev: jevObservations,
          },
```

- [ ] **Step 7: Verify nothing changed with Jev off**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc -p tsconfig.syncer.json && npm test && npm run lint
```

Expected: all clean. With `JEV_MODE` unset, `deciderFromEnv()` returns `null`, `jevMode` is `'off'`, and neither the gate result nor the observation is used.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agent/graph.ts src/lib/agent/runner.ts
git commit -m "Run Jev in shadow beside the LLM and record both answers"
```

---

### Task 8: `on` mode — Jev decides, gate skips

**Files:**
- Modify: `src/lib/agent/graph.ts` (skip path, status override, terminal guard)
- Modify: `src/lib/agent/prompts.ts` (generation-only system prompt)

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: `buildGenerationPrompt(statuses: UserStatus[]): string` exported from `prompts.ts`; `fetchGithubData` returns `{ skipped: [...] }` for a skipped task.

- [ ] **Step 1: Add the generation-only system prompt**

In `src/lib/agent/prompts.ts`, add:

```ts
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
```

- [ ] **Step 2: Skip unchanged tasks**

In `src/lib/agent/graph.ts`, directly after the Jev block added in Task 7 Step 2:

```ts
    if (state.jevMode === 'on' && observation) {
      const material = observation.noul;
      const unchanged =
        !deterministicChanged ||
        (material !== null && material < state.gateThreshold);
      if (unchanged) {
        state.onJev(observation);
        return { skipped: [...state.skipped, task.id] };
      }
    }
```

- [ ] **Step 3: Let Jev's choice win, except on terminal statuses**

Still in `fetchGithubData`, replace the single `state.analyze(...)` call with:

```ts
    // paid and wasted drop a task out of every future sync, so a wrong one
    // is invisible afterwards: the LLM confirms those.
    const terminal = new Set(
      state.userStatuses
        .filter((s) => s.group_name === 'complete')
        .map((s) => s.key)
    );
    const useJevStatus =
      state.jevMode === 'on' &&
      jevChoice !== null &&
      !terminal.has(jevChoice.choice);

    const content = await state.analyze(
      useJevStatus
        ? buildGenerationPrompt(state.userStatuses)
        : buildSystemPrompt(state.userStatuses),
      useJevStatus
        ? `${prompt}\n\n## Decided Status\nThe status is **${jevChoice!.choice}**. Echo it as suggestedStatus.`
        : prompt
    );
```

and add `buildGenerationPrompt` to the `./prompts` import.

- [ ] **Step 4: Take confidence from Jev's probability**

In the `if (jsonMatch) {` branch, after building `update`, before the observation block from Task 7:

```ts
      if (useJevStatus && jevChoice) {
        update.suggestedStatus = jevChoice.choice;
        // The probability of the chosen option is the direct analogue of
        // "how sure are you this is the status"; shadow data decides whether
        // to switch to the model's own confidence field.
        update.confidence =
          jevChoice.probabilities?.[jevChoice.choice] ?? jevChoice.confidence;
      }
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc -p tsconfig.syncer.json && npm test && npm run lint
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/graph.ts src/lib/agent/prompts.ts
git commit -m "Let Jev own the status in on mode, with the LLM confirming terminal ones"
```

---

### Task 9: Surface skips, and document the tier

**Files:**
- Modify: `src/lib/agent/runner.ts` (return and record `skipped`)
- Modify: `src/components/dashboard/last-sync-card.tsx` (counter)
- Modify: `syncer/README.md`, `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: `result.skipped` from Task 8.
- Produces: `runSync` resolves `{ tasks_updated, errors, skipped }`; `details.skipped` on the sync log.

- [ ] **Step 1: Return the skip count from the runner**

In `src/lib/agent/runner.ts`, change the success return to:

```ts
    return {
      tasks_updated: tasksUpdated,
      errors: result.errors,
      skipped: result.skipped.length,
    };
```

and the early return for an empty task list to `{ tasks_updated: 0, errors: [], skipped: 0 }`. Add `skipped: result.skipped.length` to the `details` object of the success update.

- [ ] **Step 2: Show it on the card**

In `src/components/dashboard/last-sync-card.tsx`, after the `progress` const:

```ts
  const skipped = (log.details?.skipped as number | undefined) ?? 0;
```

and replace the `Skipped, low confidence` counter with:

```tsx
          <Counter
            label={skipped ? 'Unchanged, skipped' : 'Skipped, low confidence'}
            value={skipped || skippedLowConfidence}
          />
```

renaming the existing `const skipped = updates.filter(...)` to `skippedLowConfidence`.

- [ ] **Step 3: Document it**

Add to `syncer/README.md` under the env table:

| `JEV_MODE` | `off` \| `shadow` \| `on`, default `off` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` | Workers AI, for the Jev decision tier |
| `JEV_GATE_THRESHOLD` | material-change cutoff, default `0.3` |

Add to `CLAUDE.md` in the AI Sync Agent section:

```markdown
A `Decider` (`jev.ts`) optionally runs before the analyzer: a deterministic change gate (`gate.ts`), then Jev via Cloudflare Workers AI for a material-change Noul and a status Choice built from the user's taxonomy (`questions.ts`). Date comparisons are precomputed in `facts.ts` because Jev cannot do them. `JEV_MODE` is `off` (default), `shadow` (records both answers in `sync_logs.details.jev`) or `on` (Jev decides and the gate skips). Any Jev failure falls back to the LLM path. Design: `docs/superpowers/specs/2026-09-22-jev-decision-tier-design.md`.
```

Add the same three env vars to the README's env table.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json && npm test && npm run lint && npx next build --turbopack
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/runner.ts src/components/dashboard/last-sync-card.tsx syncer/README.md CLAUDE.md README.md
git commit -m "Report skipped tasks and document the Jev tier"
```

---

## After the plan: earning `on`

Not code, and not to be done by an implementer:

1. Confirm the Cloudflare response envelope against one real call (Task 4's parser accepts two shapes because this is unverified).
2. Check Cloudflare's neuron pricing for `typesafe/jev`.
3. Set `JEV_MODE=shadow` on Vercel and Railway; leave it a week.
4. Query `sync_logs.details.jev` for status agreement overall, and separately for `paid`/`wasted`.
5. Decide `probabilities[choice]` vs `confidence` from the recorded pairs.
6. Only then `JEV_MODE=on`.
