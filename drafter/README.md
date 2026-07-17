# Tasker proposal drafter

Always-on, server-side. The missing middle of the bounty pipeline: it turns a
label-matched Expensify issue into an armed, ready-to-post proposal **without a
human in the loop**, using the Codex CLI on your ChatGPT plan.

## Where it fits

```
sniper                          drafter (this)                     sniper
──────                          ──────────────                     ──────
discovery loop matches your ──► claims queued → drafting           stages armed
watched label groups and        ├─ codex exec: draft from your     proposal, posts
INSERTs a proposals row         │   PROPOSAL_TEMPLATE prompt        it the instant
(state='queued', origin='auto') ├─ validate (headings, permalinks   Help Wanted lands
                                │   resolve, cited files exist)
                                ├─ arm (drafting → armed)
                                ├─ issue already Help Wanted?
                                │   post directly
                                └─ enrich: stronger RCA + git
                                    history + diffs (armed body,
                                    or edit the posted comment)
```

Detection, staging, and the boundary-aligned post are all the existing sniper.
This worker only fills the body and arms it. Everything runs on Railway, so it
keeps going while your laptop sleeps — the only manual step is a one-time
`codex login` to produce the auth token.

## The pipeline, per issue

1. **Claim** `queued → drafting` (atomic, state-filtered — a concurrent worker or
   a manual disarm loses the race).
2. **Draft**: `git fetch/reset` the local Expensify/App checkout, fetch the issue +
   comments, and run `codex exec` with the template prompt (`prompts/draft.md`).
3. **Validate** (mechanical, no LLM): the two required headings are present, no
   placeholder/stub text, length is sane, and every `Expensify/App` permalink both
   points at a file that exists in the clone **and** resolves on GitHub. One retry
   with the validator's complaints fed back; still failing → drop to `draft` with a
   Telegram ping so you can rescue it.
4. **Arm** `drafting → armed`. The sniper takes it from here.
5. **Direct post** if the issue already carries Help Wanted (the sniper deliberately
   ignores stale HW events).
6. **Enrich** (optional): a second, deeper `codex exec` pass — stronger root cause via
   similar cases and git history, verified permalinks, a minimal diff sketch, regression
   notes. If still armed it updates the body; if already posted it edits the live GitHub
   comment.

## Safety

- **`DRY_RUN=true` (default)** — drafts and validates, logs the proposal, mutates nothing.
- **Validator gate** — nothing arms unless it passes; failures become human-rescue drafts.
- **`proposal_auto_post` kill-switch** — the same master toggle the sniper and extension
  honor; when off, the drafter idles.
- **Manual rows are never touched** — the queue query filters `origin='auto'`, and the
  extension's guards refuse to edit `queued`/`drafting` rows.
- **Stale-claim recovery** — a `drafting` row stuck >30 min (crash/redeploy) is re-queued.
- **Codex usage limits** — detected in Codex output; the row is re-queued and the worker
  backs off 15 minutes with a Telegram warning.

## Setup

```bash
cd drafter
cp .env.example .env      # then edit
# CODEX_AUTH_JSON: paste the full contents of ~/.codex/auth.json from a
#   machine where you ran `codex login`
node drafter.mjs          # Node 22; the container also needs git + @openai/codex
```

Run the deterministic mock test (no Codex, no network, no real GitHub):

```bash
npm test
```

## Deploy (Railway)

Deploy `drafter/` as a **second service** in the same project as the sniper, using
its `Dockerfile` (Node 22 + git + the Codex CLI). **Attach a persistent volume at
`/data`** — it holds the repo clone and `CODEX_HOME/auth.json`, which Codex rewrites
in place as it refreshes the token. Without a volume the token goes stale on redeploy.

Go-live order:
1. Apply migration `007_auto_draft.sql` in Supabase.
2. Deploy the drafter with `DRY_RUN=true`; confirm a real `codex exec` completes in the
   container and read a few logged proposals for quality.
3. Flip `DRY_RUN=false` (and later `ENRICH=true`).
4. Set `AUTO_DRAFT=true` on the **sniper** service so it starts queueing.

## Tuning

- `CODEX_MODEL` pins a specific model; empty uses the account default.
- `CODEX_UNSAFE_SANDBOX=true` bypasses the Codex sandbox — only if Landlock/seccomp
  fails in Railway's kernel (the process is already isolated in its own container).
- Edit `prompts/draft.md` and `prompts/enrich.md` to tune voice and depth; they encode
  the PROPOSAL_TEMPLATE rules (three headings, SHA-pinned permalinks, no full diffs).
