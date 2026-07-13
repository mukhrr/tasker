# Tasker proposal sniper

Always-on, server-side. Races the Expensify `Help Wanted` label and posts a
pre-staged proposal within ~100–300ms of the label landing — fast enough to
**lead the pack** instead of trailing it.

## Why this beats the browser extension

The extension can only race an issue you have **open in a loaded tab**, and its
post goes content-script → MV3 service-worker (cold-start) → GitHub. Against the
wall of server-side bots that post ~1s after `Help Wanted`, that loses. This
sniper has no tab and no cold-start: it watches the repo (or your staged issues)
from a hot process and fires the instant HW lands.

## Strategy

Posting before `Help Wanted` isn't accepted on Expensify, so HW is the start
line. Melvin applies `External` **2–3s before** `Help Wanted`, which is the
opening we exploit:

1. **Lock** onto an issue the instant it gets `External`.
2. **Tight-poll** its labels on an ~80ms start-to-start cadence (ETag-conditional
   responses minimize payload size).
3. **Fire** the staged proposal the moment `Help Wanted` appears.

The proposal body is loaded and cached when the issue is first tracked, so the
trigger path does no disk I/O. Poll requests never overlap; if a GitHub response
takes longer than the configured interval, the next request starts immediately.
In extension mode, one shared repo-level detector watches for `External`; armed
proposals do not each create a permanent polling loop.

### Latency reality

`TIGHT_INTERVAL_MS=80` means up to roughly one poll interval of detection delay,
plus GitHub API propagation and the comment POST round trip. It does **not** mean
an 80ms end-to-end guarantee. A true `<50ms` label-to-created-comment guarantee
is not available through GitHub's public REST API: network RTT alone can consume
most of that budget. Deploying a continuously hot process in US East is the
largest reliable improvement. Do not reduce the interval until GitHub starts
secondary-rate-limiting the token; conditional requests still count toward API
limits even when they return `304`.

## Setup

```bash
cd sniper
cp .env.example .env          # then edit .env
# GITHUB_TOKEN: a *classic* PAT with the `public_repo` scope
#   github.com → Settings → Developer settings → Personal access tokens (classic)
node sniper.mjs               # Node 18+; zero dependencies
```

## Test it safely (no infra, no posting)

`DRY_RUN=true` is the default — it logs what it *would* post and never posts.
Run discovery against the live repo and watch it lock + detect in real time:

```bash
DRY_RUN=true DISCOVER=true node sniper.mjs
```

You'll see `🔒 locked` when an issue gets `External`, then `🧪 DRY_RUN: would
POST … via tight-poll` the moment `Help Wanted` lands. That proves the detection
latency before you ever post for real.

## Modes

- **Extension/Supabase (recommended)** — automatically watch every proposal you
  arm in the extension, with its issue-specific body already cached:
  ```bash
  SUPABASE_URL=https://your-project.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=... \
  SUPABASE_USER_ID=... \
  DRY_RUN=true node sniper.mjs
  ```
  The service-role key bypasses RLS, so the worker additionally requires and
  filters by `SUPABASE_USER_ID`. Store both as host secrets and never commit
  them. At trigger time it atomically changes `armed` to `posting`; this prevents
  duplicate comments if an extension tab detects the label at the same time.

- **Watch list** — race specific issues you've prepared:
  ```bash
  WATCH=92367,92400 node sniper.mjs
  ```
  Stage a body per issue in `proposals/<number>.md` (falls back to `proposal.md`).

- **Discover** — watch the whole repo:
  ```bash
  DISCOVER=true node sniper.mjs
  ```
  > ⚠️ **Ban risk.** Auto-posting a generic body to *every* Help Wanted issue is
  > spam and will get your account flagged. Only use discover mode if you
  > genuinely follow up each snipe with a real proposal. Be selective.

## Go live

Flip `DRY_RUN=false`. On a successful post you get `✅ sniped #N in Xms → <url>`
and (if configured) a Telegram ping so you can rush in and edit the placeholder
into your real proposal.

For extension integration, keep `DISCOVER=false` and leave `WATCH` empty. The
worker will then post only non-empty, issue-specific proposals you explicitly
armed. First verify logs show `supabase=on` and the expected `#N watching` line
while `DRY_RUN=true`.

## Deploy (always-on)

It's a single zero-dep Node file — runs anywhere that stays online:

| Host | Cost | Notes |
|------|------|-------|
| **Oracle Cloud Free Tier** | free forever | always-on ARM VM; run under `pm2`/`systemd`. Best free option. |
| **Fly.io / Railway** | ~$5/mo | easiest deploy of a long-running process. |
| **Hetzner / DigitalOcean VPS** | ~€4–6/mo | full control. |

Three latency tips that decide close races:
- **Co-locate in US-East** (Virginia) — lowest round-trip to GitHub's API.
- Keep it running 24/7; `pm2 start sniper.mjs --name sniper` (or a systemd unit)
  restarts it on crash/reboot.
- Prefer `WATCH` with a per-issue proposal file. It is selective and the body is
  cached before the trigger; repo-wide `DISCOVER` is both riskier and noisier.

## Tuning

Defaults are tuned for Expensify's 2–3s External→HW gap. If you ever see `⏸️
rate-limited`, raise `TIGHT_INTERVAL_MS` (e.g. 120) and/or `DISCOVERY_INTERVAL_MS`.
