# Tasker

Task tracking tool for open-source developers. Track proposals, assignments, PRs, reviews, and payments across GitHub repositories — with an AI agent that automatically detects status changes.

## Features

- **Notion-style table** — Inline-editable task board with 12-status workflow, custom columns, and status group tabs
- **AI-powered sync** — LangGraph.js agent analyzes GitHub activity (issues, PRs, reviews, comments) and suggests status updates. Runs on your Anthropic API key, or on your own Claude Code / Codex subscription
- **GitHub OAuth** — Sign in with GitHub, auto-link repos
- **Custom columns** — Add your own text, date, number, URL, or select fields
- **Encrypted credentials** — API keys and tokens stored with AES-256-GCM at rest
- **Auto-sync** — Re-syncs every N hours (1 to 24, per user) once switched on in Settings
- **Chrome extension** — View and update task statuses directly on GitHub issue and PR pages. On PRs, automatically detects linked issues from the description and bulk-updates their statuses

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
| `CLOUDFLARE_ACCOUNT_ID`         | No       | Workers AI account for the Jev tier           |
| `CLOUDFLARE_AI_TOKEN`           | No       | Workers AI token for the Jev tier             |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How sync works

One sync run (`src/lib/agent/runner.ts`) loads every task not yet `paid`/`wasted`, and for
each one fetches the issue, its comments and timeline events, the linked PR and its reviews,
builds a prompt from the user's own status taxonomy, and asks the model for
`{suggestedStatus, confidence, summary, pr_url, assigned_date, payment_date, amount}`.
The runner applies the summary and fields at confidence ≥ 0.6 and a status change at ≥ 0.75,
never overriding a status the user changed by hand since the last sync. Each run is a
`sync_logs` row (`queued → running → completed | failed`), which is what the toolbar reads.

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

Tasks follow a 12-status workflow grouped into three phases:

| To-do           | In Progress      | Complete   |
| --------------- | ---------------- | ---------- |
| In Proposal     | Assigned         | Paid       |
| Promising       | Reviewing        | Wasted     |
| Got C+          | Changes Required | Regression |
| Update Proposal | Awaiting Payment |            |
|                 | Merged           |            |

The AI agent detects transitions by analyzing GitHub events (assignments, PR reviews, merges, payment-related comments).

## Browser Extension

The `extension/` folder contains a Chrome extension (Manifest V3) that adds Tasker status widgets directly to GitHub.

- **On issues** — adds a status widget in the sidebar to view/update the task status
- **On PRs** — adds a status button in the header row. Parses linked issue references (`#NNNNN`) from the PR description and lets you bulk-update all tracked issues at once

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
