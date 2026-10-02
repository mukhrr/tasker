# Tasker

Task tracking tool for open-source developers. Track proposals, assignments, PRs, reviews, and payments across GitHub repositories — with an AI agent that automatically detects status changes.

## Features

- **Notion-style table** — Inline-editable task board with your own statuses, custom columns, and To-do / In Progress / Pending / Complete tabs
- **AI-powered sync** — LangGraph.js agent analyzes GitHub activity (issues, PRs, reviews, comments) and suggests status updates. Runs on your Anthropic API key, or on your own Claude Code / Codex subscription
- **GitHub OAuth** — Sign in with GitHub, auto-link repos
- **Custom columns** — Add your own text, date, number, URL, or select fields
- **Encrypted credentials** — API keys and tokens stored with AES-256-GCM at rest
- **Auto-sync** — Re-syncs every N hours (1 to 24, per user) once switched on in Settings
- **Chrome extension** — Change a task's status directly from its GitHub issue or PR page

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Database & Auth:** Supabase (PostgreSQL, RLS, OAuth, Realtime)
- **AI Agent:** LangGraph.js; Anthropic API via @langchain/anthropic, or `claude -p` / `codex exec` on the Railway syncer
- **UI:** shadcn/ui (Base UI) + Tailwind CSS 4
- **Language:** TypeScript 5, React 19

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- GitHub OAuth app configured in Supabase Auth

### Setup

1. Clone the repo:

```bash
git clone https://github.com/your-username/tasker.git
cd tasker
```

2. Install dependencies:

```bash
npm install
```

3. Copy the environment file and fill in your values:

```bash
cp .env.example .env.local
```

4. Apply database migrations:

```bash
npx supabase db push
```

5. Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable                        | Required | Description                                   |
| ------------------------------- | -------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes      | Supabase project URL                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes      | Supabase anonymous key                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes      | Supabase service role key (server-only)       |
| `ENCRYPTION_KEY`                | Yes      | 32-byte hex string for AES-256-GCM encryption |
| `CRON_SECRET`                   | Yes      | Bearer token for cron endpoint auth           |
| `JEV_MODE`                      | No       | `off` (default), `shadow` or `on` — Jev tier  |
| `SYNC_STATUS_MODE`              | No       | `suggest` (default) or `apply` status changes |
| `TYPESAFE_API_KEY`              | No       | Jev tier via TypeSafe; takes precedence       |
| `CLOUDFLARE_ACCOUNT_ID`         | No       | Jev via Workers AI, if no TypeSafe key        |
| `CLOUDFLARE_AI_TOKEN`           | No       | Jev via Workers AI, if no TypeSafe key        |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How sync works

One sync run (`src/lib/agent/runner.ts`) loads every active task (not archived, not `paid`/`wasted`).
For each one it fetches the issue, its comments and timeline events, and the linked PR with its reviews.
It builds a prompt from the user's own status taxonomy and the task's note, then asks the model for
`{suggestedStatus, confidence, summary, pr_url, assigned_date, payment_date, amount, payment_moved_to}`.
Each run is a `sync_logs` row (`queued → running → completed | failed`), which is what the toolbar and
the dashboard's Last Sync card read.

**Statuses are suggested, not applied** (`SYNC_STATUS_MODE=suggest`, the default). At confidence ≥ 0.6 the
summary and fields are written. At ≥ 0.75 a status change is recorded in `details.statusSuggestions`,
and the Last Sync card offers it with an Apply button. `SYNC_STATUS_MODE=apply` writes it directly.
A status the user changed by hand since the last sync (`status_changed_at > last_synced_at`) is never
suggested over.

What the model sees beyond the issue:

- **Reviewer feedback on the developer's open PR**: PR comments, inline review comments and COMMENTED
  reviews from humans since the last push or reply. C+ reviewers here rarely use "Request changes".
- **Bugs that blame the merged PR**: issues opened after the merge that link the PR _and_ attribute
  the bug to it (MelvinBot's "Causing PR", QA's regression-testing field, "caused by / introduced
  in / regression from"). A mention alone does not count.
- **The task's note**, as the developer's own context ("waiting for other PR" keeps a lead alive).

Rules enforced in code after the model answers (`src/lib/agent/facts.ts`):

| Rule              | Effect                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Production deploy | merged + deployed to production = `awaiting_payment`; `payment_date` = deploy + 7 days   |
| HOLD              | stays `hold` until a comment lifts it or HOLD leaves the title                           |
| Pending group     | `awaiting_payment` / `submit` never go back to To-do or In Progress, except `regression` |
| Approved          | needs a human reviewer's latest decisive review to be APPROVED                           |
| Regression        | suggested while a bug that blames the merged PR is open                                  |
| NewDot            | "Approved: @dev due $X via NewDot" counts as paid                                        |

Two task shapes get special handling:

- **PR-comment leads** (`src/lib/agent/lead.ts`): a task linked to a comment on someone's PR, kept as a
  possible new issue. The sync reads the replies and linked issues. It then relinks the task to the new
  issue, suggests `wasted` (fixed in that PR, duplicate, declined), or leaves it while nobody has decided.
- **Moved payments**: when a comment says payment is handled in another issue, the task is archived
  and that issue is added as a task.

The **Last Sync card** lists status changes and suggestions, one per issue, each with Apply and links to the issue and PR.
It also has **Needs your action**: Changes Required, Regression with its blamed bugs, and payments past their due date.
Each item there has a Mark as done button.

### Backends (Settings → AI Configuration)

| Backend        | Credential the user pastes               | Where the model runs                                             |
| -------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Claude API key | `sk-ant-…`                               | inside the web app (Vercel)                                      |
| Claude CLI     | output of `claude setup-token`           | Railway `syncer/` worker, `claude -p`, their Claude subscription |
| Codex CLI      | `~/.codex/auth.json` after `codex login` | Railway `syncer/` worker, `codex exec`, their ChatGPT plan       |

Credentials are AES-256-GCM encrypted per user. Nothing is shared between users.

### Manual sync

**Sync Now** (or the per-row sync) calls `POST /api/sync` / `POST /api/sync/task`.
API-key users get the result synchronously. CLI users get `202 { queued }`: the route
inserts a `queued` row and the toolbar polls `/api/sync/status?id=…` every 3 s until the
worker finishes. One sync per user is in flight at a time (409 otherwise).

### Auto-sync

The toggle in Settings sets `user_settings.auto_sync_enabled` and `sync_interval_hours`.
A user is due when their latest `sync_logs.started_at` is older than the interval
(`src/lib/agent/schedule.ts`). Who runs it depends on the backend:

- **CLI users**: the `syncer/` worker checks every 15 s and inserts a `queued` row for each
  due user, then processes it. Nothing else to configure; see `syncer/README.md`.
- **API-key users**: `GET /api/cron/sync` (bearer `CRON_SECRET`) runs every due user in one
  request. `.github/workflows/sync-cron.yml` calls it, but its hourly `schedule` is commented
  out because each tick spends the users' Anthropic credit; trigger it from the Actions tab
  or re-enable the schedule. Repo secrets: `CRON_SECRET` (matches the env var) and
  `TASKER_BASE_URL` (the deployed URL).

## Task Statuses

Each user owns their status taxonomy (`user_statuses`: key, label, description, group). The
descriptions are part of the sync prompt, so they define what each status means. Statuses fall
into four groups, which are also the table's tabs:

| To-do            | In Progress | Pending          | Complete |
| ---------------- | ----------- | ---------------- | -------- |
| Promising        | Reviewing   | Awaiting Payment | Paid     |
| Got C+           | Approved    | Submit in ND     | Archived |
| Update Proposal  | Merged      |                  |          |
| Assigned         | HOLD        |                  |          |
| Changes Required |             |                  |          |
| Regression       |             |                  |          |

A status whose description says "manually" (Submit in ND) is never moved by the sync.

## Browser Extension

The `extension/` folder contains a Chrome extension (Manifest V3) for changing a task's status
directly from its GitHub issue or PR page.

### Extension Setup

```bash
cd extension
npm install
npm run build
```

Then load `extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/        # Protected routes (tasks, settings)
│   ├── auth/               # Login, signup, OAuth callback
│   └── api/                # sync, settings, cron endpoints
├── components/
│   ├── task-table/         # Notion-style table + cell editors
│   └── ui/                 # shadcn/ui components
├── hooks/                  # use-tasks, use-custom-columns
├── lib/
│   ├── agent/              # LangGraph sync agent (graph, prompts, runner)
│   ├── supabase/           # Client, server, middleware
│   ├── encryption.ts       # AES-256-GCM encrypt/decrypt
│   ├── github.ts           # GitHub API wrapper
│   └── status.ts           # 12-status config and helpers
└── types/                  # TypeScript interfaces

extension/
├── src/
│   ├── background/         # Service worker (auth, task CRUD, batch updates)
│   ├── content/            # Content script + StatusWidget (issue/PR modes)
│   ├── popup/              # Extension popup (HTML/CSS/TS)
│   └── shared/             # Types, messages, constants
├── icons/                  # Extension icons (16, 48, 128)
└── manifest.json           # Manifest V3 config
```

## License

MIT
