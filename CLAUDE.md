# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server with Turbopack
npm run build        # Production build
npm run lint         # ESLint (flat config, includes Prettier)
npm start            # Production server
```

No test framework is configured yet.

## Architecture

**Next.js 16 App Router** with Supabase auth, a LangGraph.js AI agent, and a Notion-style task table.

### Route Groups

- `src/app/(dashboard)/` — Protected routes (tasks, settings). Layout checks Supabase session; redirects to `/auth/login` if unauthenticated.
- `src/app/auth/` — Login, signup, OAuth callback. Layout has decorative left panel.
- `src/app/api/` — API routes: `sync/` (POST triggers AI sync), `sync/status/` (GET), `settings/` (GET/POST), `cron/sync/` (GET, bearer-token protected).

### Supabase Three-Client Pattern

- **Browser client** (`lib/supabase/client.ts`): `createBrowserClient` — used in hooks and client components.
- **Server client** (`lib/supabase/server.ts`): `createServerClient` with `cookies()` — used in server components and API routes.
- **Middleware** (`lib/supabase/middleware.ts`): `updateSession` refreshes auth on every request. `src/middleware.ts` redirects unauthed users to login and authed users away from auth pages.

### AI Sync Agent (`lib/agent/`)

LangGraph StateGraph that loops over tasks: `fetchGithubData → advanceOrFinish → (loop or END)`. Each iteration fetches GitHub issue/PR/comments/reviews/events, calls Claude with a system prompt defining the 12-status taxonomy, and returns `{suggestedStatus, confidence, summary}`. Runner applies updates at confidence ≥ 0.6 (summary only) or ≥ 0.75 (status change).

### Task Table (`components/task-table/`)

Notion-style inline-editable table. Cell components in `cells/` subfolder (status-cell, url-cell, text-cell, date-cell, amount-cell). Each cell handles its own edit mode. The table uses `useTasks` and `useCustomColumns` hooks for CRUD with optimistic updates and Supabase Realtime subscriptions.

### Hooks (`hooks/`)

- `use-tasks.ts` — CRUD + realtime subscription on `tasks` table. Optimistic updates with rollback.
- `use-custom-columns.ts` — Custom column CRUD + field value upserts. Position-ordered.

Both hooks take `userId` and subscribe to Supabase Realtime `postgres_changes`.

### Browser Extension (`extension/`)

Chrome extension (Manifest V3) that surfaces Tasker status on GitHub issue/PR pages. Built with esbuild, plain TypeScript (no framework).

#### Structure

- `src/background/index.ts` — Service worker. Handles all message types: auth (GitHub OAuth via Supabase), task CRUD, batch queries, and linked status updates.
- `src/content/index.ts` — Content script injected on `github.com/*`. Detects issue/PR pages, mounts `StatusWidget`.
- `src/content/status-widget.ts` — Shadow DOM widget with two modes:
  - **Issue mode**: Mounts in GitHub sidebar. Shows task status or "Add to Tasker" button.
  - **PR mode**: Mounts in the PR description row (next to Open badge). Parses linked issue numbers (`#NNNNN`) from the PR description, queries which are tracked as tasks, and shows a status dropdown that bulk-updates all linked tasks.
- `src/content/github-url.ts` — Parses GitHub URLs to extract `{owner, repo, number, type}`.
- `src/popup/` — Extension popup (HTML/CSS/TS). Shows auth state and a visual hint about the widget location.
- `src/shared/` — Shared types, message definitions, constants (colors, status groups).

#### Build

```bash
cd extension
npm run build    # esbuild → dist/
npm run watch    # esbuild watch mode
```

The build copies `manifest.json`, `popup.html`, `popup.css`, and `icons/` into `dist/`. Load `extension/dist` as an unpacked extension in Chrome.

#### Message Protocol

Content script and popup communicate with the background service worker via `chrome.runtime.sendMessage`. Key message types:
- `QUERY_TASK` / `QUERY_TASKS_BATCH` — single or batch task lookup by owner/repo/number
- `UPDATE_STATUS` — update a single task
- `UPDATE_LINKED_STATUSES` — bulk update tasks by owner/repo + issue numbers array
- `CREATE_TASK` — add an issue to Tasker
- `LOGIN_GITHUB` / `LOGOUT` / `GET_SESSION` — auth flow
- `QUERY_STATUSES` — fetch user's status definitions (cached 5 min)

## Key Conventions

- **UI primitives are Base UI** (`@base-ui/react`), NOT Radix. Use `render` prop for composition (e.g., `<PopoverTrigger render={<button />}>`), NOT `asChild`.
- **shadcn/ui style**: `base-nova`. Components use CVA for variants, Tailwind CSS variables for theming (`bg-primary`, `text-foreground`), and `data-slot` attributes.
- **Path alias**: `@/*` maps to `src/*`.
- **Status system**: 12 statuses in 3 groups (todo/in_progress/complete). Config in `lib/status.ts`.
- **Encryption**: AES-256-GCM for API keys and tokens. Format: `base64(iv):base64(authTag):base64(ciphertext)`. See `lib/encryption.ts`.
- **GitHub URL parsing**: `lib/github.ts` has `parseIssueUrl()` and `parsePrUrl()` — extract owner/repo/number from URLs.
- **Tailwind CSS v4** with PostCSS. CSS variables for dark/light theming.
- **Browser extension**: After any changes in the `extension/` folder, bump the `version` in `extension/manifest.json` (semver patch/minor as appropriate).
