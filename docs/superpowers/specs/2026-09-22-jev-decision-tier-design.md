# Jev decision tier for the sync agent

Date: 2026-09-22
Status: design approved, not implemented

## Problem

A full sync is one LLM call per task, serially. On a 45-task run through `codex exec` that is
13-30s each, roughly 10-20 minutes, and it exhausts the user's Codex quota before finishing —
observed 2026-09-16, when a run died at task 23 with `codex usage limit reached`.

Most of that spend is wasted. Between two syncs most tasks have not changed in any way that
could move their status, and the agent pays full price to rediscover that.

Two further weaknesses in today's single-call design:

- **Confidence is self-reported.** `runner.ts` gates writes on `confidence >= 0.6` (fields) and
  `>= 0.75` (status change), but that number is whatever the model claims. Nothing calibrates it.
- **Date reasoning is done in prose.** `awaiting_payment` ("merged, deployed to production, and
  that deploy is at least 7 days old") and `changes_required` ("changes requested and the
  developer has not pushed since") are date comparisons the model performs by reading text.

## What Jev is, and the one constraint that shapes this design

Jev (TypeSafe AI) is a "System One" model: it does not generate text. It takes a *state* plus
typed *questions* and returns typed answers with probabilities and a confidence, trained with
RLCD to be calibrated. Three primitives: `Choice` (pick an option), `Score` (rate against ordered
levels), `Noul` (yes/no as a 0-1 probability).

**It cannot generate anything.** So it can never replace Codex/Claude in this app — `ai_summary`
is free text and `pr_url` / `amount` / `assigned_date` / `payment_date` are extracted values.
Jev is therefore not a new `ai_backend`; it is a tier that runs *before* whichever backend the
user has chosen, and `ai_backend`, the settings UI, the credentials and the DB stay untouched.

### Access and cost

> **Update 2026-09-24:** TypeSafe direct access was granted. `TYPESAFE_API_KEY` is now the
> primary route (`POST https://api.typesafe.ai/v1/systemone`, `model: "jev-latest"`) and
> Cloudflare below is the fallback. The direct response is a bare `{ model, answers, usage }`,
> confirmed live. A read-only probe of 10 real tasks agreed with the current status on 8; both
> disagreements were `wasted` picks below 0.75, stopped by the threshold and the terminal guard.

Available through **Cloudflare Workers AI** as model id `typesafe/jev`, generally available,
needs only a Cloudflare account — TypeSafe's own early access is still waitlisted, so this is
the route we use.

```
POST https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/typesafe/jev
Authorization: Bearer $CLOUDFLARE_AI_TOKEN
{ "state": <string | object | array>, "questions": { "<key>": { "type": "choice", ... } } }
```

Context window 32k tokens; our state is ~3k. TypeSafe's direct price is $0.042/1M input tokens
and $0 output, which puts a 25-task sync around $0.003. **Cloudflare bills in neurons at rates we
have not checked** — confirm before enabling `on` mode, though nothing suggests a different order
of magnitude.

### Documented weaknesses that apply to us

From TypeSafe's own jaggedness page for jev-1.13:

| Weakness | Hits us at |
| --- | --- |
| "Reads dates as text, not ordered quantities"; which came first, how far apart, inside a window — unreliable | `awaiting_payment`, `changes_required` |
| Degrades on large states full of irrelevant detail | our state is 8 comments + 30 events, mostly noise |
| Literal reading — answers the question as written, not as meant | instructions must say exactly what criteria say |
| Calibration is group-level, not a per-answer guarantee | our 0.6/0.75 thresholds are per-answer |

The date weakness is the serious one, and Phase 0 removes it by never asking Jev about dates.

## Architecture

A second seam beside `Analyzer`, used inside the existing `fetchGithubData` node. No new graph
nodes: the recursion limit stays `tasks.length * 2 + 10` and the skip is a `return`, not an edge.

```
Analyzer  (lib/agent/llm.ts)     (system, user) => Promise<string>      generation
Decider   (lib/agent/jev.ts)     (state, questions) => Promise<answers> decision      ← new
```

Per task:

```
1. fetch GitHub data                                        unchanged
2. precompute facts (Phase 0)                               new, pure TypeScript
3. gate stage 1: anything new since last_synced_at?          free, exact
      no  -> skip task, no model calls at all
4. gate stage 2: Jev Noul, is the change material?           ~200ms, ~$0.0001
      no  -> skip task
5. Jev Choice -> status + probabilities + confidence         ~200ms
6. LLM -> summary + field extraction only                    13-30s, prompt much smaller
7. merge into TaskUpdate, hand to runner                     thresholds unchanged
```

Two gate stages because they catch different things. Stage 1 is free and exact but almost never
fires on Expensify, where bot bump comments change `updated_at` constantly. Stage 2 judges
whether what changed *matters*, which is the judgement call worth paying a model for.

## Phase 0 — precomputed facts

Pure TypeScript in `graph.ts`, from data already fetched. Ships independently of Jev and improves
the LLM path on its own, so it is the first thing built and the first thing merged.

| Fact | Derived from |
| --- | --- |
| `production_deploy_at`, `days_since_production_deploy` | newest comment matching `DEPLOY_COMMENT_RE` |
| `payment_due_at`, `payment_overdue_days` | deploy date + 7 days |
| `pushed_after_changes_requested` | `prData.updated_at` vs newest human `CHANGES_REQUESTED` review `submitted_at` |
| `latest_human_review_state` | newest non-bot review (`isBot` already exists) |
| `days_since_merge`, `days_since_assigned`, `days_since_last_activity` | `merged_at`, assignment event, `updated_at` |

These join the booleans the graph already computes (`assignedToOther`, `helpWantedRemoved`,
`failing_checks`, `merge_conflicts`, `wasManuallyEdited`). The prompt's date instructions are
replaced by the computed answers, which shrinks the state — helping the second weakness too.

`payment_date` in `TaskUpdate` becomes `payment_due_at` when the LLM does not find an explicit
payment date, so the field stops depending on the model doing arithmetic.

## Gate

**Stage 1, deterministic.** Skip when `last_synced_at` exists and none of these is newer than it:
`issue.updated_at`, `prData.updated_at`, any comment `created_at`, any signal event `created_at`.
A task never synced always runs. A task the user edited by hand since the last sync always runs
(`userSetStatus`, `lib/agent/manual.ts`).

**Stage 2, Jev `Noul`.** State is only what is *new* since `last_synced_at` (new comments, new
events, PR state delta) plus the current status. Question, in plain language: could any of this
change the task's status or the facts recorded about it. Skip when the probability is below
`JEV_GATE_THRESHOLD` (default 0.3 — deliberately generous; a false skip costs a stale summary
for one interval, and we would rather pay for a needless call than miss a real change).

A skipped task is not an error and not an update. It advances `progress` and is counted in a new
`skipped` figure on the sync log, so the Last Sync card can say "19 unchanged, 6 analysed".

## Choice

`criteria` is built per request from that user's `user_statuses`: `key` → `description`. Max 255
options; the user has 14. A status with an empty description is sent as `null`, which the API
allows, but its accuracy will be poor — the implementation logs a warning naming those statuses,
and Settings should eventually require descriptions.

`instructions` mirrors the detection rules in plain language. The docs are explicit that when
instructions and criteria disagree the answer degrades, so the rules text and the description
text must say the same thing; `prompts.ts` becomes the single source for both.

State: the compact digest plus every precomputed fact. No raw dates where a computed fact exists.

**Which number feeds the thresholds** is an open decision: `confidence`, or `probabilities[choice]`.
`probabilities[choice]` is the closer analogue of "how sure are you this is the status". Both are
recorded in shadow mode and the comparison decides. Until then, `probabilities[choice]`.

## The LLM's job shrinks

`buildSystemPrompt` gains a generation-only variant: summary and field extraction, no taxonomy,
no detection rules, no confidence guidance, no `suggestedStatus` in the schema. `TASK_UPDATE_SCHEMA`
keeps its current shape for `off` mode and gains a reduced one for `shadow`/`on`.

`TaskUpdate` is then assembled from both sources — status and confidence from Jev, summary and
fields from the LLM — and handed to the existing `onUpdate`. **The runner's decision logic does
not change**: the 0.6/0.75 thresholds, `userSetStatus`, `isManualStatus`, `statusChanges` and the
archived-task filter all keep working on a `TaskUpdate` they cannot tell apart from today's. Its
only addition is counting skipped tasks (below) and writing the shadow entries.

## Modes

Env-controlled, one variable, default off.

| `JEV_MODE` | Jev runs | Gate skips | Who decides status |
| --- | --- | --- | --- |
| `off` (default, and whenever no key is set) | no | no | LLM — today's behaviour byte for byte |
| `shadow` | yes | no | LLM; Jev's answer is only recorded |
| `on` | yes | yes | Jev |

Shadow mode is how we earn `on`. Neither of us can validate Jev against this user's tasks today,
and at ~$0.0001 per task it is free to run alongside the real path for a week.

## Shadow data

No migration: `sync_logs.details` is already `jsonb`. Each entry:

```jsonc
{ "taskId": "...", "gate": { "deterministic": true, "noul": 0.82 },
  "choice": "reviewing", "probabilities": { "reviewing": 0.71, "approved": 0.2 },
  "confidence": 0.66, "llmStatus": "reviewing", "llmConfidence": 0.9,
  "agree": true, "latencyMs": 210, "error": null }
```

## Failure handling

Strictly additive. 5s timeout, one retry on 429/529 with backoff, and **any** failure — timeout,
non-200, malformed answer, missing key — falls back to the full LLM path for that task and records
`error` in the shadow entry. Jev errors never reach `FATAL_ERROR_RE` and never fail a run.

## Terminal-status guard

`paid` and `wasted` remove a task from every future sync (`runner.ts` filters them out), so a
wrong one is invisible afterwards — the failure mode seen on 2026-09-16, when archived tasks were
re-analysed and parked statuses were overwritten. In `on` mode, when Jev picks a terminal status
the LLM confirms it before the write. Rare, cheap, and it bounds the only irreversible mistake.

## Config

| Variable | Where | Notes |
| --- | --- | --- |
| `JEV_MODE` | Vercel + Railway | `off` \| `shadow` \| `on`, default `off` |
| `CLOUDFLARE_ACCOUNT_ID` | Vercel + Railway | |
| `CLOUDFLARE_AI_TOKEN` | Vercel + Railway | Workers AI scope only |
| `JEV_GATE_THRESHOLD` | optional | default `0.3` |

Both runtimes because API-key users sync inside the web app and CLI users on the Railway worker.
Plain HTTPS works in both, unlike the CLIs. Added to `.env.example` and `syncer/README.md`.

## Not doing

No per-user Jev keys, no new `ai_backend` value, no settings UI, no DB migration, no `Score`
primitive, no batching of several tasks into one request (the state is per task and the docs'
parallelism is per question within a request, not across tasks).

## Validation before `on`

1. Merge Phase 0 alone, confirm the LLM path still behaves.
2. Run `shadow` for a week of real syncs.
3. Compare: overall status agreement, and separately the `paid`/`wasted` calls.
4. Decide `confidence` vs `probabilities[choice]` from the recorded pairs.
5. Flip to `on` only on high agreement with no disagreement on terminal statuses.

## Risks

- **Accuracy on this data is unmeasured.** Mitigated by shadow mode; this is the whole reason
  shadow exists rather than shipping straight to `on`.
- **Cloudflare neuron pricing unchecked.** Confirm before `on`.
- **Latency claims (70-500ms) are the vendor's**, measured by their own team on their own
  workflows. Shadow mode measures ours.
- **A third provider to keep alive.** Bounded by fail-soft: if Jev disappears, every sync still
  works exactly as it does today.
