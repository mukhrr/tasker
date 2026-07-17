# Tasker proposal sniper

Always-on, server-side. Races the Expensify `Help Wanted` label and posts a
pre-staged proposal in the **first instant of the second after** the label
lands — guaranteed to render below it, ahead of rivals who either gamble on a
same-second post (which can render *above* the label) or detect more slowly.

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
2. **Tight-poll** its labels on an ~50ms start-to-start cadence (ETag-conditional
   responses minimize payload size).
3. **Fire** the staged proposal the moment `Help Wanted` appears — aligned to
   the **next GitHub second boundary**, not a fixed buffer.

### Why boundary alignment, not a fixed delay

GitHub truncates `created_at` to whole seconds and, within the same second, the
issue UI can render a comment **above** the label event it followed — which
looks posted-before-Help-Wanted to a reviewer. A fixed buffer can't win both
ways: too short risks the same-second tie, too long hands positions to faster
rivals. The worker instead tracks GitHub's clock from response `Date` headers
(tight polling observes a second rollover every second, pinning the boundary to
within one poll interval) and sleeps **exactly until the second after the Help
Wanted second, plus `POST_BOUNDARY_MARGIN_MS`** — firing immediately when that
boundary has already passed. The armed→posting Supabase claim happens when the
tight window **opens** (pre-claim, using the External head start), so no
database round-trip remains between Help Wanted and the comment POST. A window
that expires without Help Wanted releases the claim, and claims orphaned by a
crash or redeploy self-heal back to `armed` within ~3 minutes.

After each live snipe the worker fetches the issue timeline (~10s later) and
logs/notifies a race report: your position among post-HW comments, who beat you
and by how much, and whether you landed in the same second as the label.

### Instant Help Wanted alerts

With `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set, the discovery loop also
Telegram-alerts every issue that **newly gains** the trigger label (~1–2s after
it lands) — so you can rush in and arm a proposal. The browser extension's
notifier is limited by Chrome's 30s alarm floor plus service-worker cold
starts; the server-side alert replaces it. Alerts verify the actual label
event (a comment bumping an old Help Wanted issue never alerts), fire at most
once per issue, skip issues you already have armed (those get the snipe ping),
and never delay the lock/fire hot path. Disable with `ALERT_NEW_TRIGGER=false`.

The proposal body is loaded and cached when the issue is first tracked, so the
trigger path does no disk I/O. Poll requests never overlap; if a GitHub response
takes longer than the configured interval, the next request starts immediately.
In extension mode, one shared repo-level detector watches recently updated open
issues. It catches both the usual `External` lead and cases where `Help Wanted`
is added directly; armed proposals do not each create a permanent polling loop.

### Latency reality

`TIGHT_INTERVAL_MS=50` means up to roughly one poll interval of detection delay,
plus GitHub API propagation and the comment POST round trip. The boundary wait
then adds whatever remains of the Help Wanted second (0–1s, unavoidable — a
same-second comment can render above the label). Deploying a continuously hot
process in US East remains the largest reliable improvement.

Conditional requests still count toward API limits even when they return `304`
(this bit us on a live issue), so **every** GitHub request is counted against
`REQUEST_BUDGET_PER_MIN=500` — comfortably under GitHub's ~900 points/min
secondary limit. At the cap, discovery yields first (80% threshold), tight polls
degrade to `THROTTLED_INTERVAL_MS`, and the comment POST is never gated. A full
15s tight window at 50ms is ~300 requests, so one race plus discovery fits with
headroom; don't lower the interval below ~40ms or two overlapping races will
spend the budget.

## Setup

```bash
cd sniper
cp .env.example .env          # then edit .env
# GITHUB_TOKEN: a *classic* PAT with the `public_repo` scope
#   github.com → Settings → Developer settings → Personal access tokens (classic)
node sniper.mjs               # Node 22 LTS; zero dependencies
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

Run the deterministic local stress test with `npm run stress`. A manual GitHub
Actions workflow named **Proposal worker integration test** is also available;
it creates and closes a temporary issue only in this repository and verifies
that no proposal comment exists before Help Wanted is applied.

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
  duplicate comments. Newly seen armed rows are checked against GitHub once;
  closed issues are automatically returned to `draft` and never staged.

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

Defaults are tuned for Expensify's 2–3s External→HW gap. The request-budget
guard should keep you clear of secondary limits, but if you ever see `⏸️
rate-limited`, lower `REQUEST_BUDGET_PER_MIN` and/or raise `TIGHT_INTERVAL_MS`
(e.g. 80) and `DISCOVERY_INTERVAL_MS`. Frequent `🐢 request budget` lines mean
polling is self-throttling — raise the budget only if you are far from GitHub's
~900 points/min secondary limit.

Tune `POST_BOUNDARY_MARGIN_MS` (default 75) with two data sources: the
`stamp=` value in `✅ sniped` logs (`0s` = stamped in the target second,
`-1s` = same second as the label → raise the margin, `+1s` = a second late →
lower it or chase the post latency) and the `🔬 race:` reports showing who
landed between Help Wanted and you.
