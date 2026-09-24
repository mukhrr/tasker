# Jev in the drafter and analyzer, plus a Melvin wait

Date: 2026-09-24. Follows `2026-09-22-jev-decision-tier-design.md` (the sync agent).

## Goal

Spend Codex and Claude time only on issues likely to pay, and don't start a deep
analysis before MelvinBot has had a chance to post. Jev only decides. Every word
posted to GitHub is still written by Codex or Claude.

## What changes

| # | Where | Decision | Jev primitive | `on` mode effect |
|---|---|---|---|---|
| A0 | analyzer | Wait for Melvin before a deep analysis | none | always on |
| D1 | drafter | Is there a chance for us: will it open, or does Melvin have a gap? | 2 Nouls | skip the Codex draft only when both are low |
| D2 | drafter | Which ready row to draft first | reuses D1's Nouls | order by it instead of newest first |
| D3 | drafter | Does ours beat Melvin's? | Choice `beats` / `same` | only fills in when Codex left no marker |
| A1 | drafter, at auto-queue | Is a full repro + fix worth running? | Noul | skip the auto-queue (never a manual tap) |
| A2 | analyzer | Duplicate of Melvin (`processReview`) | Choice `duplicate` / `distinct` | replaces the `claude -p` call |
| A3 | analyzer | Reproduction route | Choice `jest` / `browser` / `none` | added to the prompt as a hint only |

### A0: Melvin wait (no Jev)

A queued `analysis_requests` row waits until MelvinBot has posted a proposal on
the issue, or `ANALYZE_MELVIN_WAIT_MS` (default 30 min, `0` disables) has passed
since `created_at`.

- `tick()` picks the oldest *ready* queued row, not the oldest row, so a waiting
  row never blocks one behind it.
- Melvin is checked with the existing `findMelvinProposal`, at most once per
  2 minutes per row (in-memory), to keep GitHub calls low.
- While waiting, the row's `progress` shows "Waiting for MelvinBot (N min left)"
  so the extension widget explains the delay.
- Applies to manual taps too. The BEATS auto-queue already has Melvin's proposal,
  so it goes straight through.

### D1 + D2: draft gate and ordering

Runs after a row is ready (External seen or `DRAFT_DELAY_MS` passed), before
`codex exec`.

State sent to Jev: title, labels, minutes since External, whether HW is present,
whether Melvin posted, Melvin's proposal text, whether an open PR is linked, and
the authors plus a short excerpt of the last few comments. Time math is computed
in JS, as in `facts.ts`.

Two Nouls in one call, because a C+ endorsing Melvin is not the end of it. The
C+ can be wrong, and a gap in Melvin's proposal is where we win:

- `opens`: the issue gets Help Wanted and opens to contributors.
- `melvin_gap`: Melvin's proposal has a gap a contributor could win on. Examples
  are a vague or wrong root cause, "escalate to backend", a missed platform or
  edge case, or no concrete fix. A C+ approving Melvin counts toward `opens`
  only, never against `melvin_gap`. With no Melvin proposal, this is 1.

A row is skipped only when both are below threshold.

- A skipped row stays `queued` with `jev_skipped_at` set. It is scored again
  hourly, and drafted immediately if Help Wanted appears. Missing a race costs
  more than a wasted draft, so `JEV_DRAFT_THRESHOLD` defaults low (0.3).
- D2 costs nothing extra: when ready rows outnumber free slots, sort by the
  higher of D1's two Nouls.

Ground truth comes for free:
- An auto proposal that reached `posted` got HW, and one still `armed` after
  `WASTE_STALE_ARMED_MS` did not.
- Whether we won comes from a task for that issue being assigned to us.

So shadow mode measures accuracy, not just agreement.

Bar for turning it on, at the chosen threshold:
- No issue we won would have been skipped.
- At least 95% of issues that got HW would still have been drafted.

### D3: Melvin verdict

Criteria are taken from `analyzer/prompts/review.md`. In shadow mode, it is
recorded beside Codex's `<!-- MELVIN: ... -->` marker. Codex has read the code
and Jev has not, so in `on` mode Jev's verdict is only used when the marker is
missing (today that means no verdict at all).

### A1: auto-analyze gate

This lives in the drafter where `queueDeepAnalysis` fires on BEATS. It uses D1's
state plus the verdict and its reason.

In `on` mode, a skip still sends the armed Telegram ping with the
"Run deep analysis" button, and adds one line saying why it wasn't auto-queued.

### A2: duplicate check

When `REVIEW_ENABLED` and Jev is `on`, `processReview` asks Jev instead of
spawning `claude -p` (a 5-minute timeout today). It stays fail-open: no answer
means `distinct`, the same as `parseReview`. Low priority, because the review
gate is off by default.

### A3: repro route

Scored before the Claude run and appended to the prompt as
"Suggested reproduction route: browser (0.81)". Claude still decides.

In shadow mode the hint is not added. The suggestion is recorded against which
check actually ran (`redGreenCheck` or `browserRedGreenCheck`).

## Shared pieces

- **Client.** `jev.mjs`, a JS port of `src/lib/agent/jev.ts`: TypeSafe first,
  Cloudflare fallback, 5s timeout, `null` on any failure. Whether it can be
  shared between workers or is copied per worker depends on the drafter's Docker
  build context, which is checked during planning.
- **Env per worker:** `TYPESAFE_API_KEY`, `JEV_MODE` (`off` / `shadow` / `on`,
  default `off`), `JEV_DRAFT_THRESHOLD`, `JEV_ANALYZE_THRESHOLD`,
  `ANALYZE_MELVIN_WAIT_MS`.
- **Record.** One new table, `jev_decisions`, with these columns: `id`,
  `user_id`, `worker`, `decision` (`d1`...`a3`), `issue_number`, `proposal_id`,
  `analysis_request_id`, `answer` (jsonb), `baseline` (jsonb: what Codex or
  Claude decided, when there is one), `acted` (bool), and `created_at`.
  - Outcomes are joined later from `proposals.state`, so there is no extra
    bookkeeping.
  - Applied through the Management API, never `supabase db push`.
- **Failure.** Any Jev failure behaves exactly as today: draft, queue, or spawn
  Claude.

## Rollout

1. A0 on its own. It needs no Jev and ships first.
2. Client, table, then D1 + D2 in shadow on Railway.
3. D3 and A1 in shadow.
4. A3 and A2.
5. After about 2 weeks of shadow data, a read-only report per decision. Each one
   is flipped to `on` separately, and only if it clears its bar.

## Out of scope

Drafting, enriching, fixing, the validator and anything else that writes text.
The sniper's post timing.
