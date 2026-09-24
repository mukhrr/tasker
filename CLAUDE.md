# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

`npm test` runs Vitest over `src/**/*.test.ts` (the agent's pure logic: facts, gate, questions, the Jev client). Nothing else has tests.

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

LangGraph StateGraph that loops over tasks: `fetchGithubData → advanceOrFinish → (loop or END)`. Each iteration fetches GitHub issue/PR/comments/reviews/events, calls the model with a system prompt built from the user's status taxonomy (`prompts.ts`), and returns `{suggestedStatus, confidence, summary, ...fields}`. Runner applies updates at confidence ≥ 0.6 (summary only) or ≥ 0.75 (status change).

The model call is an `Analyzer` (`llm.ts`: `(system, user) => Promise<string>`). `user_settings.ai_backend` picks it: `api` runs `anthropicAnalyzer` inside the web app; `claude_cli` / `codex_cli` cannot run on Vercel, so the routes insert a `queued` row in `sync_logs` and the Railway worker in `syncer/` claims it and runs `runSync` with a CLI analyzer (`syncer/analyzers.ts`). `lib/agent/backend.ts` has the shared gate (`syncReady`, `enqueueSync`).

A `Decider` (`jev.ts`) optionally runs before the analyzer: a deterministic change gate (`gate.ts`), then Jev (TypeSafe's API when `TYPESAFE_API_KEY` is set, else Cloudflare Workers AI) for a material-change Noul and a status Choice built from the user's taxonomy (`questions.ts`). Date comparisons are precomputed in `facts.ts` because Jev cannot do them. `JEV_MODE` is `off` (default), `shadow` (records both answers in `sync_logs.details.jev`) or `on` (Jev decides and the gate skips). Any Jev failure falls back to the LLM path. Design: `docs/superpowers/specs/2026-09-22-jev-decision-tier-design.md`.

Auto-sync: `user_settings.auto_sync_enabled` + `sync_interval_hours`; a user is due when the latest `sync_logs.started_at` is older than the interval (`schedule.ts` `isSyncDue`). CLI users are scheduled by the syncer worker every tick; API-key users by `GET /api/cron/sync`, whose GitHub Actions schedule is paused (`.github/workflows/sync-cron.yml`). One sync per user in flight; the toolbar polls `sync_logs` for queued runs (`lib/sync-poll.ts`). Full write-up: README "How sync works".

### Task Table (`components/task-table/`)

Notion-style inline-editable table. Cell components in `cells/` subfolder (status-cell, url-cell, text-cell, date-cell, amount-cell, note-cell). Each cell handles its own edit mode. The table uses `useTasks` and `useCustomColumns` hooks for CRUD with optimistic updates and Supabase Realtime subscriptions.

### Workers

`syncer/` (Railway, CLI-backend sync, see `syncer/README.md`), `drafter/` (Railway, Codex proposal drafts), `sniper/` (label racing), `analyzer/` (runs on the Mac with Claude Code). `Dockerfile.syncer` builds from the repo root because the worker imports `src/lib` via tsx.

### Browser Extension (`extension/`)

Chrome extension (Manifest V3) surfacing Tasker on GitHub issue/PR pages. Structure, build, and message protocol: `extension/CLAUDE.md`.

## Key Conventions

- **UI primitives are Base UI** (`@base-ui/react`), NOT Radix. Use `render` prop for composition (e.g., `<PopoverTrigger render={<button />}>`), NOT `asChild`.
- **shadcn/ui style**: `base-nova`. Components use CVA for variants, Tailwind CSS variables for theming (`bg-primary`, `text-foreground`), and `data-slot` attributes.
- **Path alias**: `@/*` maps to `src/*`.
- **Status system**: 12 statuses in 3 groups (todo/in_progress/complete). Config in `lib/status.ts`.
- **Encryption**: AES-256-GCM for API keys and tokens. Format: `base64(iv):base64(authTag):base64(ciphertext)`. See `lib/encryption.ts`.
- **GitHub URL parsing**: `lib/github.ts` has `parseIssueUrl()` and `parsePrUrl()` — extract owner/repo/number from URLs.
- **Tailwind CSS v4** with PostCSS. CSS variables for dark/light theming.
