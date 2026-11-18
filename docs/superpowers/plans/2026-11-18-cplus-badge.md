# C+ Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A C+ pill on task rows that the sync fills once and the user can toggle.

**Architecture:** A nullable boolean on `tasks`. The model reports a `role`; a pure helper decides whether the sync may write it. The Issue cell renders and toggles it.

**Tech Stack:** TypeScript, Vitest, Supabase, React, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-18-cplus-badge-design.md`

## Global Constraints

- Column: `is_reviewer boolean`, nullable, no default. Label text: `C+`.
- `role` values: `contributor`, `reviewer`, `unknown`. It is in `required`.
- The sync never changes a non-null `is_reviewer`.
- The column must exist in prod before `master` is pushed.
- Code comments: only what the code cannot say.

## Review Focus

- User turned the badge off, model says reviewer: stays off (Task 1 test).
- Model returns a role outside the enum, or none: nothing written (Task 1 test).
- A schema property missing from `required` makes Codex reject every call (Task 1 test, plus one real Codex call before deploy).
- Toggle made while a sync is running: survives (Task 1, filtered write).
- Click on the pill must not open the title editor (Task 2, checked in a browser).

---

### Task 1: Sync side

**Files:**
- Create: `supabase/migrations/20261118000000_is_reviewer.sql`, `src/lib/agent/prompts.test.ts`
- Modify: `src/types/database.ts`, `src/lib/agent/manual.ts`, `src/lib/agent/manual.test.ts`, `src/lib/agent/prompts.ts`, `src/lib/agent/graph.ts`, `src/lib/agent/runner.ts`, `src/hooks/use-tasks.ts`

**Interfaces:**
- Produces: `Task.is_reviewer: boolean | null`; `TaskUpdate.role?: string`; `reviewerToWrite(task: Pick<Task, 'is_reviewer'>, role: string | null | undefined): boolean | null`

- [ ] **Step 1: Failing tests.** `reviewerToWrite`: null + `reviewer` → true; null + `contributor` → false; null + `unknown` → null; null + `'maintainer'` → null; null + undefined → null; true + `contributor` → null; false + `reviewer` → null. Schema: every key of `TASK_UPDATE_SCHEMA.properties` is in `required`, and `role` is among them.
- [ ] **Step 2: Run** `npx vitest run src/lib/agent/manual.test.ts src/lib/agent/prompts.test.ts`, expect FAIL.
- [ ] **Step 3: Implement** the helper, the type, the migration file, `role` in the schema and in both prompts' JSON blocks with the "unknown unless positive evidence" rule, `role: result.role` in the graph's update, the filtered write in `applyUpdate`, the carry-over in the payment-moved insert, `is_reviewer: null` in the optimistic task.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`, expect clean.
- [ ] **Step 5: Commit.**

### Task 2: Badge in the UI

**Files:**
- Modify: `src/components/task-table/cells/issue-cell.tsx`, `src/components/task-table/task-row.tsx`, `src/components/task-detail.tsx`

**Interfaces:**
- Consumes: `Task.is_reviewer`.

- [ ] **Step 1:** `IssueCell` gains `isReviewer: boolean | null` and `onReviewerChange?: (value: boolean) => void`. A pill button after the title; `stopPropagation` on click; lit when true, otherwise `opacity-0` until the cell is hovered or focused. Without `onReviewerChange` it renders only when true, as a plain span. Use it in the archived branch of `task-row.tsx` and in the detail header.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx eslint` on the three files, expect clean.
- [ ] **Step 3: Commit.**

### Verification and rollout

- [ ] One real Codex call with the new schema on `Expensify/App#107179`, expect a parsed answer with `role`.
- [ ] Apply the migration to prod; select `is_reviewer` through supabase-js.
- [ ] No sync in flight, merge to `master`, push, wait for both deploys.
- [ ] Queue a sync; in a fresh tab check #107179 and #107170 have the badge and #105037 does not; toggle a C+ row off, reload, on.
