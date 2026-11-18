# Sync Discovers Assigned Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full sync adds open issues assigned to the user in the last 14 days as `assigned` tasks and syncs them in the same run.

**Architecture:** Pure selection logic in `src/lib/agent/discover.ts`. Two GitHub helpers in `src/lib/github.ts`. `runSync` calls them before loading the run's task list, inserts the rows, and records them in `sync_logs.details.discovered` for the Last Sync card.

**Tech Stack:** TypeScript, Vitest, Supabase JS, GitHub REST.

**Spec:** `docs/superpowers/specs/2026-11-18-sync-discover-assigned-design.md`

## Global Constraints

- Window: 14 days. Status key: `assigned`. Note text: `Added by sync`. Search page size: 50.
- Runs only when `taskId` and `resumeAfter` are both unset.
- A discovery failure never fails the sync; it becomes one string in `details.errors`.
- Code comments follow the repo owner's rule: only what the code cannot say, one or two sentences.
- No commits unless the user asks.

## Review Focus

- Issue with more than 100 events whose `assigned` event is on a later page: must still be found (Task 2 pages events; Task 1 tests latest-event selection).
- Existing row with null `repo_owner`/`issue_number` or a markdown `[url](url)` `issue_url`: must still dedup (Task 1 test).
- User with zero active tasks: discovery must still run (Task 2 moves it above the early return).
- Unassigned then reassigned: the latest `assigned` event decides, not the first (Task 1 test).
- Taxonomy without an `assigned` key: nothing inserted, one error recorded (Task 2).

---

### Task 1: Selection logic

**Files:**
- Create: `src/lib/agent/discover.ts`
- Test: `src/lib/agent/discover.test.ts`

**Interfaces:**
- Produces:
  - `DISCOVERY_WINDOW_DAYS = 14`
  - `interface SearchHit { html_url: string; title: string; number: number; pull_request?: unknown }`
  - `searchCutoff(now: Date): string` returns `YYYY-MM-DD`, 14 days before `now` (UTC)
  - `newHits(hits: SearchHit[], existing: Pick<Task, 'issue_url' | 'repo_owner' | 'repo_name' | 'issue_number'>[]): SearchHit[]` drops pull requests and anything whose `issueKey` matches an existing row; a comment-link row does not block its issue
  - `recentAssignment(events: GitHubEvent[], username: string, now: Date): string | null` returns `created_at` of the latest `assigned` event for `username` (case-insensitive) when it is within 14 days of `now`, else null

- [ ] **Step 1: Write failing tests** covering: hit already tracked by columns; hit tracked only by a markdown `issue_url` with null columns; owner/repo case difference; pull request hit dropped; untracked hit kept; `recentAssignment` returns the later of two assigned events; returns null at 15 days; ignores another user's assignment; `searchCutoff(new Date('2026-11-18T10:00:00Z')) === '2026-11-04'`.
- [ ] **Step 2: Run** `npx vitest run src/lib/agent/discover.test.ts`, expect FAIL (module missing).
- [ ] **Step 3: Implement.** `newHits` builds a Set of `issueKey(row)` and compares `issueKey({ issue_url: hit.html_url })`. If `parseIssueUrl` fails on the markdown form, extract the URL first with the regex the card already uses (`/https:\/\/github\.com\/[^\s)\]]+/`).
- [ ] **Step 4: Run** the same command, expect PASS.

### Task 2: GitHub helpers and runner wiring

**Files:**
- Modify: `src/lib/github.ts`, `src/lib/agent/runner.ts`, `CLAUDE.md` (one line in the sync section)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `searchAssignedIssues(username: string, since: string, token: string): Promise<SearchHit[]>` calling `/search/issues?q=is:issue+is:open+assignee:<username>+updated:>=<since>&sort=updated&order=desc&per_page=50`, returning `items`
  - `fetchAllIssueEvents(owner, repo, number, token): Promise<GitHubEvent[]>` paging `events?per_page=100&page=N` until a page has fewer than 100, capped at 10 pages
  - `details.discovered: { taskId: string; issue_url: string; issue_title: string }[]`

- [ ] **Step 1: Add the two helpers** to `github.ts`.
- [ ] **Step 2: Reorder `runSync`:** load `finalStatuses` (with the seed fallback) before the task query, so discovery can read it and the empty-tasks return stays below discovery.
- [ ] **Step 3: Add `discoverAssigned`** in `runner.ts`, called when `!taskId && !resumeAfter`, before the task query. It selects `issue_url, repo_owner, repo_name, issue_number` for every row of the user (no status or archived filter), runs `searchAssignedIssues`, `newHits`, then per hit `fetchAllIssueEvents` and `recentAssignment`. It inserts `{ user_id, issue_url: hit.html_url, issue_title: hit.title, repo_owner, repo_name, issue_number, status: 'assigned', status_group, assigned_date, note: 'Added by sync' }` and collects `discovered`. No `assigned` key in the taxonomy: return an error string, insert nothing. Whole call wrapped in try/catch returning `{ discovered, errors }`. Because inserts happen before the task query, the query picks the new rows up; no array splicing needed.
- [ ] **Step 4: Carry `discovered`** into all four `details` writes (empty-tasks, `onProgress`, final, failure) and prepend discovery errors to `details.errors` in the final and empty-tasks writes.
- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit`, expect both clean.

### Task 3: Last Sync card

**Files:**
- Modify: `src/components/dashboard/last-sync-card.tsx`

**Interfaces:**
- Consumes: `details.discovered` from Task 2.

- [ ] **Step 1:** Read `discovered` beside the other `details` fields; when non-empty render a "New tasks" block in the left column, above "Status changes", one row per item: title (fallback `shortRef(issue_url)`) and the existing `GitHubLink`. Match the neighbouring block's classes.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npm run lint`, expect clean.

### Verification

- [ ] Dry run against the real account: a script in the scratchpad that calls `searchAssignedIssues`, `newHits` (against the user's rows, read-only) and `recentAssignment`, and prints what would be inserted. No writes.
