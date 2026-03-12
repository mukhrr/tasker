# Tasker

Task tracking tool for open-source developers. Track proposals, assignments, PRs, reviews, and payments across GitHub repositories — with an AI agent that automatically detects status changes.

## Features

- **Notion-style table** — Inline-editable task board with 12-status workflow, custom columns, and status group tabs
- **AI-powered sync** — LangGraph.js agent analyzes GitHub activity (issues, PRs, reviews, comments) and suggests status updates using Claude
- **GitHub OAuth** — Sign in with GitHub, auto-link repos
- **Custom columns** — Add your own text, date, number, URL, or select fields
- **Encrypted credentials** — API keys and tokens stored with AES-256-GCM at rest
- **Auto-sync** — Scheduled sync via GitHub Actions cron (every 6 hours)

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Database & Auth:** Supabase (PostgreSQL, RLS, OAuth, Realtime)
- **AI Agent:** LangGraph.js + @langchain/anthropic (Claude)
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

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only) |
| `ENCRYPTION_KEY` | Yes | 32-byte hex string for AES-256-GCM encryption |
| `CRON_SECRET` | Yes | Bearer token for cron endpoint auth |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### GitHub Actions (Auto-Sync)

The cron workflow at `.github/workflows/sync-cron.yml` calls `/api/cron/sync` every 6 hours. Add these as GitHub repo secrets:

- `CRON_SECRET` — matches your env var
- `APP_URL` — your deployed URL (e.g., `https://tasker.vercel.app`)

## Task Statuses

Tasks follow a 12-status workflow grouped into three phases:

| To-do | In Progress | Complete |
|-------|-------------|----------|
| In Proposal | Assigned | Paid |
| Promising | Reviewing | Wasted |
| Got C+ | Changes Required | Regression |
| Update Proposal | Awaiting Payment | |
| | Merged | |

The AI agent detects transitions by analyzing GitHub events (assignments, PR reviews, merges, payment-related comments).

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
```

## License

MIT
