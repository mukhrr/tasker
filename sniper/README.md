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
2. **Tight-poll** its labels every ~80ms (ETag-conditional → free `304`s).
3. **Fire** the staged proposal the moment `Help Wanted` appears.

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

## Deploy (always-on)

It's a single zero-dep Node file — runs anywhere that stays online:

| Host | Cost | Notes |
|------|------|-------|
| **Oracle Cloud Free Tier** | free forever | always-on ARM VM; run under `pm2`/`systemd`. Best free option. |
| **Fly.io / Railway** | ~$5/mo | easiest deploy of a long-running process. |
| **Hetzner / DigitalOcean VPS** | ~€4–6/mo | full control. |

Two latency tips that decide close races:
- **Co-locate in US-East** (Virginia) — lowest round-trip to GitHub's API.
- Keep it running 24/7; `pm2 start sniper.mjs --name sniper` (or a systemd unit)
  restarts it on crash/reboot.

## Tuning

Defaults are tuned for Expensify's 2–3s External→HW gap. If you ever see `⏸️
rate-limited`, raise `TIGHT_INTERVAL_MS` (e.g. 120) and/or `DISCOVERY_INTERVAL_MS`.
