# C+ badge on a task row

Approved 2026-11-18.

## Intent

Show at a glance which tasks the user holds as the reviewer (C+ on Expensify), not as the contributor. The sync labels them, and the user can override.

## Goals and non-goals

- Goal: a "C+" pill after the title in the Issue cell and in the task detail header; click to toggle.
- Goal: the sync fills it from the issue, once.
- Non-goal: changing status suggestions for reviewer tasks, a filter or tab, the browser extension.
- Anti-goal: the sync undoing a value the user set.

## Approaches

1. **Three-state column filled by the model** (picked). `tasks.is_reviewer boolean null`: null is undecided, and the sync only writes while it is null.
2. Deriving it from GitHub data alone. Rejected: reviewer and contributor are both plain assignees; the difference is in comments.
3. A second column recording who set it. Rejected: the null state already protects the user's toggle.

## Design

- Migration: `ALTER TABLE public.tasks ADD COLUMN is_reviewer boolean`. Applied to prod through the Management API before the deploy.
- Model answer gains `role`: `contributor`, `reviewer` or `unknown` (a plain enum, in `required`, because Codex enforces the schema). Both prompts tell it to answer `unknown` without positive evidence, since the first answer is permanent.
- `reviewerToWrite(task, role)` in `manual.ts`: returns true or false only when `task.is_reviewer` is null and the role is one of the two known values. Written at the usual 0.6 confidence bar, in its own update filtered on `is_reviewer is null`, so a toggle made during a run survives.
- The payment-moved insert carries the value to the new row.
- UI: `IssueCell` takes `isReviewer` and `onReviewerChange`. Lit pill when true; a faint one on hover otherwise. Archived rows show it without a toggle. A click stores the opposite of what is shown, so it always leaves a decided value.

## Calls made by the builder

- Column name `is_reviewer`, label "C+".
- Rows not synced (paid, wasted, archived) stay undecided.

## Changed after the branch review (2026-11-18)

- The role is decided in code, not taken from the model as is: the bot's "Contributor-plus team member ... @login" comment means reviewer, the developer's own PR means contributor, both together stay undecided. A model "reviewer" is accepted; a model "contributor" without a PR is not stored, so it is retried.
- A failed badge write is recorded in `details.errors` and does not stop the sync.
- The task detail header shows the badge read-only.
- Known gap: with `JEV_MODE=on`, a task the gate skips is not labelled until it has new activity.
