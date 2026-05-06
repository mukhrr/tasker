# Tasker Proposals Worker

Long-running Node process that polls `Expensify/App` (and any other repo
with armed proposals) for the `Help Wanted` label, then auto-posts the
queued comment.

## Required env vars

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...                    # service role, NOT anon
ENCRYPTION_KEY=<32-byte base64>                     # same key the Next.js app uses
POLL_INTERVAL_MS=1500                               # active cadence (optional)
POLL_IDLE_INTERVAL_MS=60000                         # idle cadence when no armed rows (optional)
```

The same `ENCRYPTION_KEY` must be set on `taskerr.it.com` — both sides need
to encrypt/decrypt the GitHub provider token.

## Run locally

```bash
cp .env.example .env.local   # add the four vars above
npm install
npm run worker
```

Expect log lines like:

```
[proposals-worker] starting; active=1500ms idle=60000ms
[proposals-worker] realtime subscribed
[proposals-worker] cycle ok | repos=1 matches=0 posted=0 failed=0 | 142ms
```

`matches=0` is normal until someone actually adds Help Wanted to an armed issue.

## Deploy

### Railway (recommended)

1. New project → Deploy from GitHub repo → pick this repo.
2. Railway autodetects Node + reads `railway.json`.
3. In the service's Variables tab, add the four env vars above.
4. The service stays up via `restartPolicyType: ON_FAILURE`.

`Procfile` is also present for Heroku-style platforms (Render, Railway alt).

### Fly.io

```bash
fly launch --no-deploy --copy-config       # picks up fly.toml + Dockerfile.worker
fly secrets set \
  NEXT_PUBLIC_SUPABASE_URL=… \
  SUPABASE_SERVICE_ROLE_KEY=… \
  ENCRYPTION_KEY=…
fly deploy
fly logs                                    # tail the worker
```

The Dockerfile installs only the deps needed for the worker (no Next.js
build) and runs `tsx worker/index.ts` directly.

## Verifying it's alive

From your machine, hit the debug route on the web app:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://taskerr.it.com/api/proposals/poll
```

Returns `{ repos, matches, posted, failed }`. Equivalent to one worker tick;
useful when you suspect the worker is stuck.

## Cost

One Node process making mostly-304 requests every 1.5s → typically <50MB RAM,
negligible CPU. Free tier on Railway/Fly is sufficient.
