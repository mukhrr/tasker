# Tasker analyzer — "Run Claude analysis" worker

Runs **on your Mac** (not Railway): it uses your Claude Code **subscription**
auth, your local Expensify/App checkout, and leaves the fix as a local `git
stash` you pop when you win the assignment.

Pipeline per request (queued by the extension's 🧠 button on an issue):

1. claim the request (`analysis_requests` in Supabase)
2. preflight — refuses to run if the checkout has uncommitted changes
3. `claude -p` headless (`--dangerously-skip-permissions`) in the checkout:
   reproduce via Playwright when feasible, verify the root cause, implement the
   minimal fix locally (**never commits**)
4. stash exactly the files the run changed (`tasker-analysis-#N`)
5. update your posted proposal comment (or the Supabase draft/armed body)
6. Telegram ping with the summary + stash name

## Setup

```bash
cd analyzer
cp .env.example .env   # fill in (same values as the Railway workers)
node --env-file=.env analyzer.mjs
# keep the Mac awake while analyses run:  caffeinate -i node --env-file=.env analyzer.mjs
```

Requires: Node ≥ 20.6, `claude` CLI logged in (subscription), the App checkout
at `APP_REPO_DIR`.

⚠️ `--dangerously-skip-permissions` lets Claude run commands unattended in the
checkout, working from untrusted issue text. The analyzer strips Tasker's
secrets from its environment, but treat the checkout directory as the blast
radius. Retrieve a fix later with `git stash list` → `git stash pop`.
