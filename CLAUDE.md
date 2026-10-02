# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

`npm test` runs Vitest over `src/**/*.test.ts` (the agent's pure logic: facts and status guards, leads, gate, questions, the Jev client).

## Architecture

**Next.js 16 App Router** with Supabase auth, a LangGraph.js AI agent, and a Notion-style task table.

### Route Groups

- `src/app/(dashboard)/` — Protected routes (tasks, settings). Layout checks Supabase session; redirects to `/auth/login` if unauthenticated. Includes `dashboard/` (stats/analytics) and `tasks/[id]/` (single task detail).
- `src/app/auth/` — Login, signup, OAuth callback. Layout has decorative left panel.
- `src/app/api/` — API routes: `sync/` (POST; runs the sync for API-key users, returns `202 {queued}` for CLI users), `sync/task/` (POST single-task, same split), `sync/status/` (GET latest or `?id=`), `settings/` (GET/POST, includes `ai_backend` and the CLI credentials), `cron/sync/` (GET, bearer-token protected; API-key users only).
- `src/app/privacy/` — Privacy policy (public page).

### Supabase Three-Client Pattern

- **Browser client** (`lib/supabase/client.ts`): `createBrowserClient` — used in hooks and client components.
- **Server client** (`lib/supabase/server.ts`): `createServerClient` with `cookies()` — used in server components and API routes.
- **Middleware** (`lib/supabase/middleware.ts`): `updateSession` refreshes auth on every request. `src/middleware.ts` redirects unauthed users to login and authed users away from auth pages.

### AI Sync Agent (`lib/agent/`)

LangGraph StateGraph that loops over tasks: `fetchGithubData → advanceOrFinish → (loop or END)`. `shouldContinue` runs after the index advanced, so it compares `currentIndex < tasks.length`.

Each iteration:

- fetches the issue, its comments and events, and the PR with its reviews;
- for the developer's open PR, also fetches reviewer feedback since the last push;
- for their merged PR, fetches the issues that blame it (`lead.ts` `blamesPr`);
- calls the model with a prompt built from the user's status taxonomy and the task's `note` (`prompts.ts`).

Code guards in `facts.ts` then adjust the suggested status: `paymentStatus` (production deploy → awaiting_payment), `holdLifted`, `approvedByReviewer`, `regressionFromLinkedBugs`, `keepPending`.

The runner writes the summary and fields at confidence ≥ 0.6. A status change at ≥ 0.75 is only recorded in `sync_logs.details.statusSuggestions` for the Last Sync card's Apply button, unless `SYNC_STATUS_MODE=apply`. `manual.ts` `userSetStatus` compares `status_changed_at` (not `updated_at`, which the DB trigger stamps after the sync's own write) with `last_synced_at`.

The model call is an `Analyzer` (`llm.ts`: `(system, user, schema?) => Promise<string>`). Codex enforces `schema` via `--output-schema`, so each call passes its own shape (`TASK_UPDATE_SCHEMA`, `LEAD_SCHEMA`). `user_settings.ai_backend` picks it: `api` runs `anthropicAnalyzer` inside the web app; `claude_cli` / `codex_cli` cannot run on Vercel, so the routes insert a `queued` row in `sync_logs` and the Railway worker in `syncer/` claims it and runs `runSync` with a CLI analyzer (`syncer/analyzers.ts`). `lib/agent/backend.ts` has the shared gate (`syncReady`, `enqueueSync`).

A `Decider` (`jev.ts`) optionally runs before the analyzer: a deterministic change gate (`gate.ts`), then Jev (TypeSafe's API when `TYPESAFE_API_KEY` is set, else Cloudflare Workers AI) for a material-change Noul and a status Choice built from the user's taxonomy (`questions.ts`). Date comparisons are precomputed in `facts.ts` because Jev cannot do them. `JEV_MODE` is `off` (default), `shadow` (records both answers in `sync_logs.details.jev`) or `on` (Jev decides and the gate skips). Any Jev failure falls back to the LLM path. Design: `docs/superpowers/specs/2026-09-22-jev-decision-tier-design.md`.

A task whose link is a comment on a PR is a _lead_ (`lead.ts`): a bug the developer reported on someone's PR. The sync reads the replies after it and any issue linking back, then relinks the task to a new issue, suggests `wasted` (fixed in that PR, duplicate, declined), or leaves it as is while nobody has decided. When a comment moves payment to another issue (`payment_moved_to`, `payment-move.ts`), the runner archives the task and inserts one for that issue.

Auto-sync: `user_settings.auto_sync_enabled` + `sync_interval_hours`; a user is due when the latest `sync_logs.started_at` is older than the interval (`schedule.ts` `isSyncDue`). CLI users are scheduled by the syncer worker every tick; API-key users by `GET /api/cron/sync`, whose GitHub Actions schedule is paused (`.github/workflows/sync-cron.yml`). One sync per user in flight; the toolbar polls `sync_logs` for queued runs (`lib/sync-poll.ts`). Full write-up: README "How sync works".

### Task Table (`components/task-table/`)

Notion-style inline-editable table. Cell components in `cells/` subfolder (status-cell, url-cell, text-cell, date-cell, amount-cell, note-cell). Each cell handles its own edit mode. The table uses `useTasks` and `useCustomColumns` hooks for CRUD with optimistic updates and Supabase Realtime subscriptions.

### Workers

`syncer/` (Railway, CLI-backend sync, see `syncer/README.md`). `Dockerfile.syncer` builds from the repo root because the worker imports `src/lib` via tsx.

### Browser Extension (`extension/`)

Chrome extension (Manifest V3) for adding tasks and changing their status from GitHub issue/PR pages. Structure, build, and message protocol: `extension/CLAUDE.md`.

## Key Conventions

- **UI primitives are Base UI** (`@base-ui/react`), NOT Radix. Use `render` prop for composition (e.g., `<PopoverTrigger render={<button />}>`), NOT `asChild`.
- **shadcn/ui style**: `base-nova`. Components use CVA for variants, Tailwind CSS variables for theming (`bg-primary`, `text-foreground`), and `data-slot` attributes.
- **Path alias**: `@/*` maps to `src/*`.
- **Status system**: per-user taxonomy in `user_statuses` (key, label, description, group). Four groups: todo / in_progress / pending / complete, which are the table's tabs. Descriptions feed the sync prompt; one saying "manually" is never moved by the sync. Helpers in `lib/status.ts`.
- **Encryption**: AES-256-GCM for API keys and tokens. Format: `base64(iv):base64(authTag):base64(ciphertext)`. See `lib/encryption.ts`.
- **GitHub URL parsing**: `lib/github.ts` has `parseIssueUrl()` and `parsePrUrl()` — extract owner/repo/number from URLs.
- **Tailwind CSS v4** with PostCSS. CSS variables for dark/light theming.
