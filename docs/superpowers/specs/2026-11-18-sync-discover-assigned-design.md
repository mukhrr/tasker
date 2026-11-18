# Sync discovers newly assigned issues

Approved 2026-11-18.

## Intent

Each full sync notices issues GitHub has newly assigned to the user and adds them to the table as `assigned`, so they no longer have to be added by hand.

## Goals and non-goals

- Goal: a newly assigned open issue appears in the table after the next full sync, with title, amount and summary filled by that same run.
- Non-goal: discovering PRs, review requests, or issues the user only commented on.
- Anti-goal: a row the user deleted or closed out coming back.

## Approaches

1. **Discovery step at the start of `runSync`** (picked). One place, so the Railway worker, the web route and cron all get it, and new rows join the run that found them.
2. A separate discovery job in `syncer/`. Rejected: API-key users would not get it, and new rows would wait a full interval for their first sync.
3. A graph node. Rejected: the graph loops per task, and discovery is once per run and needs DB writes the runner owns.

## Design

- Runs only on a full sync (`taskId` unset, `resumeAfter` unset).
- One GitHub search: `is:issue is:open assignee:<username>`, all repos, newest first, first page of 50.
- Drop any hit that already has a row for the user in any state (archived, paid and wasted included), matched on owner/repo/number, case-insensitive.
- For the rest, read the issue events and keep the hit only when the latest `assigned` event for the user is within the last 14 days. This is what stops a deleted row from coming back forever.
- Insert with status `assigned`, its `status_group` from the user's taxonomy, `assigned_date` from the event, `issue_title` from the search hit, note `Added by sync`. If the taxonomy has no `assigned` key, insert nothing and record an error.
- Inserted rows are appended to the run's task list.
- `sync_logs.details.discovered` lists the inserted task ids; the Last Sync card shows them as "New tasks".
- Any discovery failure is recorded in `details.errors` and the sync carries on.

## Calls made by the builder, not the user

- 14 day window and all repos (both shown to the user and accepted).
- Pure logic (filtering hits, picking the assignment date) lives in `src/lib/agent/discover.ts` with Vitest tests; the runner does the I/O.

## Changed after the branch review (2026-11-18)

- A row linked to a comment on an issue counts as tracking that issue.
- Issues an earlier sync added (read from `sync_logs.details.discovered` over the window) are never added again, so deleting an auto-added row sticks.
- The sync only fills an empty `assigned_date`; it no longer rewrites one already set.
- The `sync_logs` row is created before discovery, and discovery errors are stored in `details`, not returned to the route.
- One issue that cannot be read does not stop the others.
