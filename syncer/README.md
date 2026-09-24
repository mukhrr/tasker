# Tasker syncer

Always-on worker that runs the AI sync for users whose backend is **Claude CLI**
or **Codex CLI** (Settings → AI Configuration). API-key users are untouched: their
syncs still run inside the web app and `/api/cron/sync`.

## How it fits

```
web app                                  syncer (this)
───────                                  ─────────────
Sync Now / per-task sync with a CLI  ──► claims queued → running
backend INSERTs sync_logs                runs src/lib/agent/runner.ts with a
(status='queued', backend, task_id)      claude -p / codex exec analyzer
                                         marks completed / failed
Auto-sync toggle on                  ──► every tick: users with auto_sync_enabled
                                         and a CLI backend whose interval elapsed
                                         get a queued row
```

The toolbar polls `/api/sync/status` until the row settles, so the UI is the same as
the API path, just a few seconds slower.

## Credentials

Each user connects their own subscription, nothing is shared:

- **Claude CLI**: the user runs `claude setup-token` and pastes the `sk-ant-oat…`
  token. Stored AES-encrypted in `user_settings.claude_oauth_token_encrypted`, passed
  to `claude -p` as `CLAUDE_CODE_OAUTH_TOKEN` with `CLAUDE_CONFIG_DIR=/data/claude/<user>`.
- **Codex CLI**: the user runs `codex login` and pastes `~/.codex/auth.json`. Stored in
  `user_settings.codex_auth_encrypted`, written to `/data/codex/<user>/auth.json`
  (`CODEX_HOME`). Codex rotates tokens in place; after each run a changed file is
  re-encrypted back into the DB, so a lost volume only costs one reseed.

## Safety

- Claude runs with `--restricted --tools ""`: no tools at all, pure text analysis.
- Codex runs `--ephemeral --sandbox read-only` in an empty scratch dir. Landlock is
  unavailable on Railway, so set `CODEX_UNSAFE_SANDBOX=true` there; the model still has
  no repo, no secrets in its environment (see `ENV_DENYLIST`), and only the scratch dir.
- The prompt includes untrusted issue/PR text. Treat `/data/scratch` as the blast radius.
- One sync per user in flight; `running` rows older than 30 min are failed on the next
  tick (crash/redeploy recovery). Usage-limit and login errors abort the run and surface
  in the toolbar as friendly messages (`src/lib/sync-errors.ts`).

## Run

```bash
# local, against the same Supabase as the web app
npm run syncer            # reads .env via dotenv; needs DATA_DIR writable (default /data)
DATA_DIR=/tmp/tasker-syncer npm run syncer
```

Railway: service with root `/`, variable `RAILWAY_DOCKERFILE_PATH=Dockerfile.syncer`,
volume mounted at `/data`.

| Variable                                                | Purpose                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | queue + settings access                                  |
| `ENCRYPTION_KEY`                                        | same key as the web app, decrypts the pasted credentials |
| `DATA_DIR`                                              | volume root (default `/data`)                            |
| `CLAUDE_MODEL`, `CODEX_MODEL`                           | optional model override, else the account default        |
| `CODEX_UNSAFE_SANDBOX`                                  | `true` on Railway                                        |
| `CLI_TIMEOUT_MS`                                        | per-task CLI cap (default 120000)                        |
| `POLL_INTERVAL_MS`                                      | tick interval (default 15000)                            |
| `JEV_MODE`                                              | `off` \| `shadow` \| `on`, default `off`                 |
| `TYPESAFE_API_KEY`                                      | Jev decision tier via TypeSafe; takes precedence         |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`          | Jev via Workers AI, used when no TypeSafe key is set     |
| `JEV_GATE_THRESHOLD`                                    | material-change cutoff, default `0.3`                    |
