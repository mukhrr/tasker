#!/usr/bin/env node
/**
 * Tasker proposal drafter — always-on, server-side.
 *
 * The sniper enqueues label-matched Expensify issues into Supabase as
 * state='queued', origin='auto'. This worker picks them up and, using the
 * Codex CLI (authenticated with the user's ChatGPT plan), writes a proposal
 * that conforms to Expensify's PROPOSAL_TEMPLATE, validates it mechanically,
 * and arms it so the sniper posts it the instant Help Wanted lands. Issues
 * that already carry Help Wanted are posted directly.
 *
 * Pipeline per issue:
 *   queued → (claim) drafting → codex draft → validate → armed → [enrich]
 *   armed + issue already has Help Wanted → posting → posted (direct post)
 *
 * Safety: DRY_RUN=true logs the drafted proposal and never mutates Supabase or
 * posts to GitHub. The validator gates every arm, and validation failures drop
 * the row to state='draft' for a human to rescue (with a Telegram ping).
 */

import { readFile, writeFile, mkdir, cp, readdir, open } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── config ──────────────────────────────────────────────────────────────────
const REPO = process.env.REPO || 'Expensify/App';
const [REPO_OWNER, REPO_NAME] = REPO.split('/');
const TRIGGER = (process.env.LABEL_TRIGGER || 'Help Wanted').toLowerCase();
const LOCK = (process.env.LABEL_LOCK || 'External').toLowerCase();
// Same list the sniper refuses to queue. Re-checked here because a queued row
// waits DRAFT_DELAY_MS before drafting, and because rows queued before this
// check existed are still sitting in the backlog.
const DEAD_LABELS = new Set(
  (process.env.LABEL_DEAD || 'Internal,Awaiting Payment')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_USER_ID = process.env.SUPABASE_USER_ID || '';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''; // classic PAT, public_repo
const GITHUB_API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const TG_API = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');

const DRY_RUN = bool('DRY_RUN', true);
const ENRICH = bool('ENRICH', false); // second, deeper pass after arming
const DIRECT_POST = bool('DIRECT_POST', true); // post immediately if HW already present
// Master on/off for the drafter. When false, it idles (claims/drafts nothing),
// leaving queued rows untouched until re-enabled. Flip this Railway variable to
// pause auto-pilot without redeploying anything else.
const AUTOPILOT_ENABLED = bool('AUTOPILOT_ENABLED', true);

const DATA_DIR = process.env.DATA_DIR || '/data';
const CODEX_HOME = process.env.CODEX_HOME || path.join(DATA_DIR, 'codex');
const CODEX_AUTH_JSON = process.env.CODEX_AUTH_JSON || ''; // seed for auth.json
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const CODEX_MODEL = process.env.CODEX_MODEL || ''; // '' → account default
const CODEX_UNSAFE_SANDBOX = bool('CODEX_UNSAFE_SANDBOX', false); // Landlock fallback
// Backstop only: runCodexProcess returns the instant Codex writes its proposal,
// so this fires solely when Codex produces NO output at all. Generous because the
// single deep pass (git history + similar cases + diffs) can legitimately run
// several minutes before the proposal lands.
const CODEX_TIMEOUT_MS = int('CODEX_TIMEOUT_MS', 900_000); // 15 min hard cap for a stuck process
const REPO_URL = process.env.REPO_URL || `https://github.com/${REPO}`;
const REPO_DIR = process.env.REPO_DIR || path.join(DATA_DIR, REPO_NAME || 'App');
// The expensify-proposal-writer skill (bundled under drafter/skills) is installed
// into CODEX_HOME so Codex discovers it, and the draft prompt reads it by path.
const BUNDLED_SKILLS_DIR = process.env.BUNDLED_SKILLS_DIR || path.join(HERE, 'skills');
const SKILL_NAME = process.env.SKILL_NAME || 'expensify-proposal-writer';
const SKILL_DIR = path.join(CODEX_HOME, 'skills', SKILL_NAME);

const POLL_INTERVAL_MS = int('POLL_INTERVAL_MS', 12000); // 12s — the drafter isn't latency-critical; keeps Supabase egress low
// The sniper queues on labels alone. Drafting starts the moment `External`
// appears — it lands right after MelvinBot posts, so it's a free signal that
// there's a proposal to compare against — and this is the cap on how long to
// wait for it. Past the cap Melvin isn't coming, so draft as the only proposal.
const DRAFT_DELAY_MS = int('DRAFT_DELAY_MS', 10 * 60_000);
// Cap the per-tick label lookups so a mass-labeling burst can't spend the
// GitHub budget deciding what to draft. Unchecked rows just wait a poll.
const MAX_LABEL_CHECKS_PER_TICK = int('MAX_LABEL_CHECKS_PER_TICK', 8);
// How many issues to draft at once. Codex runs are network-bound, so parallel
// drafts compress a mass-labeling backlog's wall-clock (~4-5 min per draft
// serially) without using more plan quota in total.
// Lowered from 3 to 2 on 2026-08-13: three simultaneous Codex runs over the same
// checkout set the container's memory high-water mark, and Railway bills held
// memory (memory was $12.37 of a $19 month while vCPU was $0.86). Two only costs
// wall-clock when three or more issues queue in the same burst.
const MAX_CONCURRENT_DRAFTS = int('MAX_CONCURRENT_DRAFTS', 2);
const STALE_DRAFTING_MS = int('STALE_DRAFTING_MS', 30 * 60_000); // reclaim after 30 min
const STALE_SWEEP_MS = int('STALE_SWEEP_MS', 60_000);
const MAX_DRAFT_ATTEMPTS = int('MAX_DRAFT_ATTEMPTS', 3);
// Wasted-draft telemetry: since the 2026-07-25 Melvin flow change, many
// auto-drafted issues never get Help Wanted (the C+ takes the PR route), so the
// deep draft's Codex quota is spent for nothing. This periodic report measures
// the waste from DB state alone (no GitHub calls): `posted` = HW arrived and we
// raced it; an auto proposal still `armed` well past typical C+ review almost
// certainly never got HW. Informs whether to gate drafting on HW/solicitation.
const WASTE_REPORT_INTERVAL_MS = int('WASTE_REPORT_INTERVAL_MS', 60 * 60_000); // hourly
const WASTE_REPORT_ENABLED = bool('WASTE_REPORT_ENABLED', true);
// Armed-and-open this long with no HW ⇒ counted as "likely wasted" (C+ review
// rarely runs past this; tune if the real distribution differs).
const WASTE_STALE_ARMED_MS = int('WASTE_STALE_ARMED_MS', 24 * 60 * 60_000);

// A Codex draft leaves the process holding several hundred MB that V8 and glibc
// never hand back, and the drafter then idles for hours at that high-water mark
// while Railway bills it. Exiting once idle drops it back to a ~60 MB boot.
// OFF by default because it is only safe when the Railway service's restart
// policy is ALWAYS: under the default ON_FAILURE, a clean exit(0) is treated as
// a finished job and the drafter would simply stay down. Set the policy first,
// then set IDLE_RESTART_MS (1200000 = 20 min).
const IDLE_RESTART_MS = int('IDLE_RESTART_MS', 0); // 0 disables

const DRAFT_PROMPT_FILE = process.env.DRAFT_PROMPT_FILE || path.join(HERE, 'prompts', 'draft.md');
const ENRICH_PROMPT_FILE = process.env.ENRICH_PROMPT_FILE || path.join(HERE, 'prompts', 'enrich.md');
const INTERIM_PROMPT_FILE = process.env.INTERIM_PROMPT_FILE || path.join(HERE, 'prompts', 'interim.md');

// Fast interim arm: a concise, valid proposal armed in ~1 min right after
// queueing, so the sniper always has ammunition even when Help Wanted lands
// minutes after queue — before the ~4-min deep draft is ready (missed
// #96732/#96742 entirely). The full draft then replaces the body.
// RETIRED by default as of the 2026-07-25 Melvin flow change: Help Wanted now
// lands hours after queue (C+ review gate), so there's ample time for the full
// deep draft before any race — and the Melvin-review gate compares only the
// full draft. The interim's extra Codex call is now pure cost. Re-enable with
// FAST_INTERIM_ARM=true only if the fast External→HW flow returns.
const FAST_INTERIM_ARM = bool('FAST_INTERIM_ARM', false);
const INTERIM_TIMEOUT_MS = int('INTERIM_TIMEOUT_MS', 120_000);
const INTERIM_CODEX_MODEL = process.env.INTERIM_CODEX_MODEL || CODEX_MODEL;

// Watch the issue the moment a proposal is armed. An armed proposal now waits
// hours for the C+ review gate, and everything that decides its fate happens on
// the issue in the meantime (the C+ comment, Help Wanted, Internal, a close).
// Posting a comment subscribes you automatically, but that is far too late.
const SUBSCRIBE_ON_ARM = bool('SUBSCRIBE_ON_ARM', true);

// ── state ───────────────────────────────────────────────────────────────────
let backoffUntil = 0; // Codex usage-limit backoff
let lastStaleSweepAt = 0;
let lastWasteReportAt = 0;
let draftsInFlight = 0; // concurrent draftOne calls, capped at MAX_CONCURRENT_DRAFTS
let draftsSinceBoot = 0; // 0 ⇒ still at the boot memory baseline, nothing to reclaim
let lastDraftEndedAt = 0;
const dryRunSeen = new Set(); // issues already dry-drafted this process (no re-loop)

// ── logging + telegram ────────────────────────────────────────────────────────
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// 'essential' messages (posts, failures, usage limits) always send; 'verbose'
// ones (per-issue "draft armed" chatter) send only when TELEGRAM_VERBOSE is on.
const TELEGRAM_VERBOSE = bool('TELEGRAM_VERBOSE', false);
async function notify(text, { level = 'essential', replyMarkup } = {}) {
  if (level === 'verbose' && !TELEGRAM_VERBOSE) return;
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const res = await fetch(`${TG_API}/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`telegram err: ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  } catch (e) {
    log(`telegram err: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Supabase REST ─────────────────────────────────────────────────────────────
async function supabaseRequest(pathname, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 300)}`);
  }
  return data;
}

// ── GitHub REST ────────────────────────────────────────────────────────────────
async function gh(pathname, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tasker-drafter',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  if (body) headers['Content-Type'] = 'application/json';
  const url = pathname.startsWith('http') ? pathname : GITHUB_API + pathname;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

function labelNames(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
}

// Subscribe to issue notifications. REST has no per-issue subscription endpoint
// (it 404s), so this is GraphQL-only; node_id comes free on the REST issue
// payload we already fetched. GraphQL answers 200 with an `errors` array when
// the token lacks the `notifications` scope, so success is the returned
// viewerSubscription, never the status code.
async function subscribeToIssue(n, issue) {
  if (!SUBSCRIBE_ON_ARM || !issue?.node_id) return;
  try {
    const { data } = await gh('/graphql', {
      method: 'POST',
      body: {
        query:
          'mutation($id:ID!){updateSubscription(input:{subscribableId:$id,state:SUBSCRIBED}){subscribable{viewerSubscription}}}',
        variables: { id: issue.node_id },
      },
    });
    if (data?.data?.updateSubscription?.subscribable?.viewerSubscription === 'SUBSCRIBED') {
      log(`🔔 #${n} subscribed to the issue`);
      return;
    }
    log(`#${n} subscribe failed: ${data?.errors?.[0]?.message || JSON.stringify(data).slice(0, 200)}`);
  } catch (e) {
    log(`#${n} subscribe errored: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── shell helper ───────────────────────────────────────────────────────────────
function run(cmd, args, { cwd, env, timeoutMs, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      // No input → give the child /dev/null for stdin so it sees EOF immediately.
      // A dangling open stdin pipe makes some CLIs (codex exec) linger after the
      // task is done, waiting on input that never comes.
      stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + `\n${e.message}`, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

// ── boot: seed Codex auth + clone the repo ────────────────────────────────────
async function ensureCodexAuth() {
  await mkdir(CODEX_HOME, { recursive: true });
  const authPath = path.join(CODEX_HOME, 'auth.json');
  if (existsSync(authPath)) return; // already seeded; Codex refreshes it in place
  if (!CODEX_AUTH_JSON) {
    log('⚠️  no CODEX_HOME/auth.json and no CODEX_AUTH_JSON — Codex is unauthenticated');
    return;
  }
  await writeFile(authPath, CODEX_AUTH_JSON, { mode: 0o600 });
  log(`🔑 seeded ${authPath} from CODEX_AUTH_JSON`);
}

async function installSkills() {
  // Copy the bundled skill onto the volume so Codex can discover it and the
  // draft prompt can read it by absolute path. Overwrite each boot to pick up
  // edits shipped with a redeploy.
  if (!existsSync(BUNDLED_SKILLS_DIR)) return;
  const dest = path.join(CODEX_HOME, 'skills');
  await mkdir(dest, { recursive: true });
  try {
    await cp(BUNDLED_SKILLS_DIR, dest, { recursive: true });
    log(`📚 installed skills → ${dest}`);
  } catch (e) {
    log(`skill install failed (continuing): ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function ensureRepo() {
  if (!existsSync(path.join(REPO_DIR, '.git'))) {
    await mkdir(path.dirname(REPO_DIR), { recursive: true });
    log(`⏬ cloning ${REPO_URL} → ${REPO_DIR} (blobless)`);
    const res = await run('git', ['clone', '--filter=blob:none', REPO_URL, REPO_DIR], {
      timeoutMs: 600_000,
    });
    if (res.code !== 0) throw new Error(`git clone failed: ${res.stderr.slice(0, 300)}`);
  }
}

async function refreshRepo() {
  // With concurrent drafts, never `reset --hard` while another draft may have a
  // codex run mid-investigation in the same checkout. Solo drafts refresh; the
  // rest ride the existing checkout — at most minutes stale, and the draft
  // prompt has codex `git fetch origin main` itself for SHA-pinned permalinks
  // (fetch is safe concurrently; only the reset moves the working tree).
  if (draftsInFlight > 1) {
    log('repo refresh skipped — another draft is using the checkout');
    return;
  }
  const fetchRes = await run('git', ['fetch', 'origin', 'main', '--quiet'], {
    cwd: REPO_DIR,
    timeoutMs: 120_000,
  });
  if (fetchRes.code !== 0) {
    log(`git fetch failed (continuing on stale checkout): ${fetchRes.stderr.slice(0, 200)}`);
    return;
  }
  await run('git', ['reset', '--hard', 'origin/main', '--quiet'], { cwd: REPO_DIR, timeoutMs: 60_000 });
}

// ── Codex ─────────────────────────────────────────────────────────────────────
// Every `codex exec` run writes a rollout file under
// CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl — the file
// `codex exec resume <uuid>` replays — so the filenames are the authoritative
// session-id source. It is written from session START, so it survives
// runCodexProcess SIGKILLing Codex the moment the proposal lands (which is also
// why the previous source, session_index.jsonl written at clean shutdown, never
// materialized here and every captured id was null). With
// MAX_CONCURRENT_DRAFTS > 1 several runs can be in flight, so runCodex snapshots
// the ids before its run and attributes the new one afterwards, disambiguating
// concurrent finishers by the issue marker embedded in each draft prompt.
const ROLLOUT_ID_RE = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

async function rolloutFiles() {
  try {
    const dir = path.join(CODEX_HOME, 'sessions');
    const names = await readdir(dir, { recursive: true });
    return names
      .map((rel) => ({ file: path.join(dir, rel), m: ROLLOUT_ID_RE.exec(rel) }))
      .filter((e) => e.m)
      .map((e) => ({ file: e.file, id: e.m[1] }));
  } catch {
    return [];
  }
}

// The prompt is in the rollout's first lines, so a bounded head read is enough
// to tell which issue a session belongs to.
async function rolloutHead(file, bytes = 256 * 1024) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

// The environment handed to the Codex subprocess. Codex runs model-authored
// shell commands (and, when the container's bubblewrap sandbox is unavailable,
// runs them un-sandboxed), while the issue text it works from is untrusted. So
// Tasker's own secrets must never be reachable from that process's environment —
// a prompt injection in an issue must not be able to read the Supabase
// service-role key, GitHub token, or Telegram token. Codex authenticates from
// CODEX_HOME/auth.json on disk, not from the environment, so stripping these is
// safe. (auth.json itself still lives on the volume; this reduces, not
// eliminates, the un-sandboxed blast radius — hence keep the container isolated.)
const CODEX_ENV_DENYLIST = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'SUPABASE_USER_ID',
  'GITHUB_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'CODEX_AUTH_JSON',
];
function codexSubprocessEnv() {
  const env = { ...process.env, CODEX_HOME };
  for (const k of CODEX_ENV_DENYLIST) delete env[k];
  return env;
}

async function runCodex(prompt, { threadName, marker, model = CODEX_MODEL, timeoutMs = CODEX_TIMEOUT_MS } = {}) {
  const outFile = path.join(tmpdir(), `codex-${process.pid}-${Date.now()}.md`);
  // `codex exec` is non-interactive by design and does not accept the `-a`
  // approval flag (that lives on the top-level `codex` command). Sandbox mode
  // controls what model-generated commands may do; no approval flag is needed.
  const args = ['exec', '-C', REPO_DIR, '--skip-git-repo-check', '--output-last-message', outFile];
  if (CODEX_UNSAFE_SANDBOX) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true');
  }
  if (model) args.push('-m', model);
  // Best-effort: label the session by issue. `codex exec` currently ignores this
  // (it assigns an auto-incrementing name), but we read the real id back either
  // way, so this just helps if a future Codex honors it.
  if (threadName) args.push('-c', `thread_name=${JSON.stringify(threadName)}`);
  // Prompt over stdin ('-'), never as argv: Linux caps a single argument at
  // 128 KiB, and a busy issue blows past that (spawn fails with E2BIG before
  // Codex even starts).
  args.push('-');

  // Snapshot session ids so this run's session can be identified afterwards even
  // with other codex runs in flight (see rolloutFiles).
  const sessionsBefore = new Set((await rolloutFiles()).map((r) => r.id));
  const res = await runCodexProcess(CODEX_BIN, args, {
    env: codexSubprocessEnv(),
    timeoutMs,
    outFile,
    input: prompt,
  });

  // Prefer the proposal Codex wrote to --output-last-message. Codex finishes the
  // task fast (~1–2 min) but the process often lingers afterward (a still-open
  // web-search socket, telemetry flush, etc.); runCodexProcess kills it the moment
  // the file lands, and we salvage that file here even when the process had to be
  // killed by the watcher or the hard timeout. Only when NO output was produced do
  // we surface a timeout / usage / exit error, so a completed draft is never lost.
  let body = '';
  try {
    body = (await readFile(outFile, 'utf8')).trim();
  } catch {
    body = '';
  }
  if (!body) {
    const blob = `${res.stdout}\n${res.stderr}`;
    if (/usage limit|rate limit|too many requests|quota/i.test(blob)) {
      return { ok: false, error: 'codex usage limit', usageLimited: true };
    }
    if (res.timedOut) return { ok: false, error: `codex timed out after ${timeoutMs}ms` };
    if (res.code != null && res.code !== 0) {
      return { ok: false, error: `codex exited ${res.code}: ${res.stderr.slice(0, 300)}` };
    }
    body = res.stdout.trim(); // last-resort fallback
  }
  if (!body) return { ok: false, error: 'codex produced an empty proposal' };
  const fresh = (await rolloutFiles()).filter((r) => !sessionsBefore.has(r.id));
  // One new rollout → unambiguous. Several (concurrent runs) → the one whose
  // prompt contains this run's issue marker; first as a last resort.
  let session = fresh[0] || null;
  if (fresh.length > 1 && marker) {
    for (const r of fresh) {
      if ((await rolloutHead(r.file).catch(() => '')).includes(marker)) {
        session = r;
        break;
      }
    }
  }
  return { ok: true, body, sessionId: session?.id || null };
}

// Run `codex exec`, but stop waiting the moment it writes its final proposal to
// --output-last-message. Codex often completes the task in ~1–2 min yet the
// process keeps running (lingering web-search / telemetry handles); without this
// it would sit until CODEX_TIMEOUT_MS, get SIGKILLed, and the finished draft would
// be discarded as a "timeout". Once the output file is non-empty we let it flush
// briefly, then kill the process and resolve — the caller reads the file.
function runCodexProcess(cmd, args, { env, timeoutMs, outFile, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      // env is a complete, pre-scrubbed environment (see codexSubprocessEnv) — do
      // NOT merge process.env back in, or the secrets we removed would return.
      env,
      stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (input != null) {
      // The watcher below kills Codex the moment the proposal file lands, which
      // can happen while stdin is still draining — swallow the resulting EPIPE
      // rather than letting an unhandled 'error' take down the drafter.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killing = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (watch) clearInterval(watch);
      resolve(r);
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {
            /* already exited */
          }
        }, timeoutMs)
      : null;
    // Poll for the completed proposal; kill Codex as soon as it lands so a
    // lingering process doesn't stall the draft for the full timeout window.
    const watch = setInterval(() => {
      if (killing) return;
      let size = 0;
      try {
        size = statSync(outFile).size;
      } catch {
        /* file not written yet */
      }
      if (size > 0) {
        killing = true;
        clearInterval(watch);
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already exited */
          }
        }, 750);
      }
    }, 1000);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (e) => finish({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, timedOut }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }));
  });
}

// A ready-to-paste command to continue a drafter Codex session from a terminal.
// Includes CODEX_HOME so it works locally and via `railway ssh` into the service.
function resumeHint(sessionId) {
  if (!sessionId) return '';
  return `\nResume the Codex session:\nCODEX_HOME=${CODEX_HOME} codex exec resume ${sessionId} "<your follow-up>"`;
}

// ── validator ──────────────────────────────────────────────────────────────────
const REQUIRED_HEADINGS = [
  '### What is the root cause of that problem?',
  '### What changes do you think we should make in order to solve the problem?',
];
const PLACEHOLDER_RE = /(_investigating|_detailed proposal|placeholder|reviewing this issue|proposal is on the way|TODO|FIXME|lorem ipsum)/i;

// Codex states how its draft compares to MelvinBot's on a trailing marker line.
// It has already read Melvin's proposal to write the draft, so this costs
// nothing; the alternative is a second model re-deriving the same comparison.
// Split it off before validation so the marker can never reach GitHub, and
// tolerate its absence — an older session or a stubborn model just means no
// verdict, not a failed draft.
// Not anchored to the end: the prompt asks for the marker last, but a model that
// writes one more line would otherwise leak it into a posted GitHub comment.
function splitMelvinVerdict(body) {
  if (!body) return { body, verdict: null };
  let verdict = null;
  const stripped = body
    .replace(/\n*<!--\s*MELVIN:\s*(BEATS|SAME|ABSENT)\b[\s—:-]*([^>]*?)\s*-->/gi, (_m, kind, reason) => {
      verdict ??= { kind: kind.toUpperCase(), reason: (reason || '').trim().slice(0, 200) };
      return '';
    })
    .trimEnd();
  return { body: stripped, verdict };
}

// The armed ping. Shaped like the analyzer's review ping it replaces, because
// that one was readable and actionable: verdict in the headline, the reasoning
// under "Why:", and a button that queues the deep analysis. The Codex resume
// command stays in the Railway log — it's debugging text, not mission control.
const ARMED_HEADLINE = {
  BEATS: "✅ Proposal armed — beats MelvinBot's",
  SAME: "⚠️ Proposal armed — same as MelvinBot's",
  ABSENT: 'ℹ️ Proposal armed — no MelvinBot proposal',
};

function armedMessage({ n, title, issueUrl, body, verdict }) {
  const headline = ARMED_HEADLINE[verdict?.kind] || '📝 Proposal armed';
  const lines = [`${headline}`, `${REPO}#${n} — ${title}`, issueUrl, ''];
  if (verdict?.reason) lines.push(`Why: ${verdict.reason}`);
  lines.push(
    verdict?.kind === 'SAME'
      ? "It adds nothing over Melvin's, so it's probably not worth posting — disarm it in Tasker if you agree."
      : "It's armed and will be posted when the issue opens to contributors.",
  );
  lines.push('Tap below to run a deep Claude analysis and verify it.');
  lines.push(`(${body.length} chars, validated)`);
  return lines.join('\n');
}

// Same callback_data the analyzer daemon's getUpdates listener already handles —
// it matches on `run:<issue>` and the chat id, not on which process sent it.
function runAnalysisButtons(n, issueUrl) {
  return {
    inline_keyboard: [
      [
        { text: '🔬 Run deep analysis', callback_data: `run:${n}` },
        { text: 'View issue', url: issueUrl },
      ],
    ],
  };
}

async function validateProposal(body) {
  const problems = [];
  if (!body || body.length < 200) problems.push('proposal is too short (<200 chars)');
  if (body.length > 20_000) problems.push('proposal is too long (>20000 chars)');
  for (const h of REQUIRED_HEADINGS) {
    if (!body.includes(h)) problems.push(`missing required heading: "${h}"`);
  }
  if (PLACEHOLDER_RE.test(body)) problems.push('contains placeholder / stub text');

  // Every Expensify blob permalink must resolve, and its cited path must exist
  // in the local clone (a hallucinated file is the most common failure mode).
  const linkRe = /https:\/\/github\.com\/Expensify\/App\/blob\/([0-9a-f]{7,40})\/([^\s#)]+)(#L\d+(?:-L\d+)?)?/gi;
  const links = [...body.matchAll(linkRe)];
  for (const m of links) {
    const filePath = decodeURIComponent(m[2]);
    if (!existsSync(path.join(REPO_DIR, filePath))) {
      problems.push(`cited file does not exist in the repo: ${filePath}`);
      continue;
    }
    // Confirm the link resolves on GitHub (SHA + path). A 404 means a bad SHA
    // or a path that isn't on main.
    try {
      const res = await fetch(m[0].split('#')[0], { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      if (res.status >= 400) problems.push(`permalink does not resolve (${res.status}): ${m[0].slice(0, 80)}`);
    } catch {
      problems.push(`permalink unreachable: ${m[0].slice(0, 80)}`);
    }
  }
  return problems;
}

// ── proposal lifecycle ─────────────────────────────────────────────────────────
async function updateProposal(id, values, { requireState } = {}) {
  const query = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${SUPABASE_USER_ID}` });
  if (requireState) query.set('state', `eq.${requireState}`);
  const rows = await supabaseRequest(`proposals?${query}`, {
    method: 'PATCH',
    body: values,
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function claimQueued(row) {
  // Atomic queued → drafting; a concurrent worker or a manual disarm loses the race.
  return updateProposal(row.id, { state: 'drafting' }, { requireState: 'queued' });
}

// Comment budget. stdin lifted the hard E2BIG ceiling, but 150 KB of rival
// proposals still crowds the model's context and invites copying them. Oldest
// first, so MelvinBot's proposal (the one worth beating) always survives.
const COMMENT_CHAR_CAP = 6_000; // per comment
const COMMENTS_CHAR_BUDGET = 48_000; // across all of them

function renderComments(comments) {
  const parts = [];
  let spent = 0;
  for (const c of (comments || []).slice(0, 20)) {
    if (spent >= COMMENTS_CHAR_BUDGET) {
      parts.push(`--- (${(comments.length - parts.length)} further comment(s) omitted) ---`);
      break;
    }
    const raw = c.body || '';
    const clipped =
      raw.length > COMMENT_CHAR_CAP
        ? `${raw.slice(0, COMMENT_CHAR_CAP)}\n… (comment truncated, ${raw.length - COMMENT_CHAR_CAP} chars omitted)`
        : raw;
    parts.push(`--- comment by ${c.user?.login || '?'} ---\n${clipped}`);
    spent += clipped.length;
  }
  return parts.join('\n\n');
}

async function buildDraftPrompt(issue, comments) {
  const template = await readFile(DRAFT_PROMPT_FILE, 'utf8');
  const commentText = renderComments(comments);
  const issueBlock =
    `Issue #${issue.number}: ${issue.title}\n\n${issue.body || '(no description)'}\n` +
    (commentText ? `\n### Existing comments\n\n${commentText}\n` : '');
  return template
    .replaceAll('<<<SKILL_DIR>>>', SKILL_DIR)
    .replace('<<<ISSUE>>>', issueBlock);
}

async function draftOne(row, settings = { autoPost: true }) {
  const n = row.issue_number;
  // In DRY_RUN the row is returned to `queued` after drafting (it never arms),
  // so without this guard it would be re-drafted every poll — an endless loop
  // that burns Codex quota. Draft each queued issue at most once per process.
  if (DRY_RUN && dryRunSeen.has(n)) return;
  const claimed = await claimQueued(row);
  if (!claimed) {
    log(`#${n} claim skipped — no longer queued`);
    return;
  }
  log(`✍️  #${n} drafting (attempt ${(claimed.draft_attempts || 0) + 1})`);

  await refreshRepo();
  const { status, data: issue } = await gh(`/repos/${REPO}/issues/${n}`);
  if (status !== 200 || !issue || typeof issue !== 'object') {
    await failDraft(claimed, `could not fetch issue (${status})`);
    return;
  }
  if (issue.state !== 'open') {
    await updateProposal(claimed.id, {
      state: 'draft',
      last_error: 'Auto-disarmed: issue is closed.',
    });
    log(`🚫 #${n} closed — dropped to draft`);
    return;
  }
  const dead = labelNames(issue.labels).find((l) => DEAD_LABELS.has(l));
  if (dead && !claimed.force_draft) {
    await updateProposal(claimed.id, {
      state: 'draft',
      last_error: `Auto-disarmed: issue is labelled "${dead}".`,
    });
    log(`🚫 #${n} is "${dead}" — dropped to draft`);
    return;
  }
  const { data: comments } = await gh(`/repos/${REPO}/issues/${n}/comments?per_page=30`);
  const commentList = Array.isArray(comments) ? comments : [];

  // Fast interim arm: get a concise, valid proposal armed in ~1 min so the
  // sniper always has ammunition, then let the full deep draft replace it.
  let interimArmed = false;
  if (FAST_INTERIM_ARM && !DRY_RUN) {
    interimArmed = await armInterim(claimed, n, issue, commentList, settings);
  }

  const prompt = await buildDraftPrompt(issue, commentList);
  const result = await draftWithValidation(prompt, claimed, { keepArmedOnFail: interimArmed });
  if (!result) {
    if (interimArmed) log(`#${n} full draft did not complete — interim remains armed`);
    return; // failure paths handled inside (or interim left armed)
  }

  const { body, sessionId, verdict } = result;

  if (DRY_RUN) {
    log(
      `🧪 DRY_RUN #${n}: would arm this proposal (${body.length} chars):\n${body.slice(0, 400)}…` +
        resumeHint(sessionId),
    );
    dryRunSeen.add(n); // don't re-draft this issue while it stays queued
    // Return the row to queued so a real run can pick it up later. State-filtered
    // so a user Cancel (drafting → draft) mid-flight is not overwritten.
    await updateProposal(claimed.id, { state: 'queued', codex_session_id: sessionId }, { requireState: 'drafting' });
    return;
  }

  const armed = await finalizeFullDraft(claimed, n, issue, body, sessionId, settings, interimArmed, verdict);
  if (!armed) return;

  if (ENRICH) {
    await enrichOne(armed.id, n, body);
  }
}

// Build the concise first-pass prompt (no permalinks / investigation) from the
// interim template.
async function buildInterimPrompt(issue, comments) {
  const template = await readFile(INTERIM_PROMPT_FILE, 'utf8');
  const commentText = (comments || [])
    .slice(0, 10)
    .map((c) => `--- comment by ${c.user?.login || '?'} ---\n${c.body || ''}`)
    .join('\n\n');
  const issueBlock =
    `Issue #${issue.number}: ${issue.title}\n\n${issue.body || '(no description)'}\n` +
    (commentText ? `\n### Existing comments\n\n${commentText}\n` : '');
  return template.replace('<<<ISSUE>>>', issueBlock);
}

// Draft a concise proposal fast, validate, and arm it (drafting → armed).
// Direct-posts immediately if Help Wanted is already present. Returns true when
// an interim body is armed. Never throws — a failure just falls through to the
// full pass, i.e. today's behavior.
async function armInterim(claimed, n, issue, comments, settings) {
  try {
    const prompt = await buildInterimPrompt(issue, comments);
    const draft = await runCodex(prompt, {
      threadName: `tasker-${n}-interim`,
      marker: `Issue #${n}:`,
      model: INTERIM_CODEX_MODEL,
      timeoutMs: INTERIM_TIMEOUT_MS,
    });
    if (!draft.ok) {
      log(`⏭️  #${n} interim skipped: ${draft.error}`);
      return false;
    }
    draft.body = splitMelvinVerdict(draft.body).body;
    const problems = await validateProposal(draft.body);
    if (problems.length) {
      log(`⏭️  #${n} interim discarded — validation failed: ${problems.join('; ')}`);
      return false;
    }
    const armed = await updateProposal(
      claimed.id,
      { state: 'armed', body: draft.body, last_error: null, codex_session_id: draft.sessionId },
      { requireState: 'drafting' },
    );
    if (!armed) {
      log(`#${n} interim arm skipped — row changed under us`);
      return false;
    }
    log(`⚡ #${n} interim armed (${draft.body.length} chars) — full draft continuing`);
    await subscribeToIssue(n, issue);
    // If Help Wanted is already present the sniper ignores the stale label, so
    // post the interim now to be in the race; the full draft edits it later.
    const hasHW = labelNames(issue.labels).includes(TRIGGER);
    if (DIRECT_POST && hasHW && settings.autoPost) {
      await directPost(armed, issue, draft.body);
    }
    return true;
  } catch (e) {
    log(`interim #${n} errored (continuing to full): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// Put the full draft where it belongs given the row's current state, and notify.
// Returns the row (for the enrich pass) or null when nothing further should run.
async function finalizeFullDraft(claimed, n, issue, body, sessionId, settings, interimArmed, verdict) {
  const issueUrl = `https://github.com/${REPO}/issues/${n}`;

  if (!interimArmed) {
    // Original path: arm drafting → armed, direct-post if Help Wanted present.
    const armed = await updateProposal(
      claimed.id,
      {
        state: 'armed',
        body,
        last_error: null,
        draft_attempts: (claimed.draft_attempts || 0) + 1,
        codex_session_id: sessionId,
      },
      { requireState: 'drafting' },
    );
    if (!armed) {
      log(`#${n} arm skipped — row changed under us (manual edit?)`);
      return null;
    }
    log(`📝 #${n} armed${sessionId ? ` [codex ${sessionId}]` : ''}${resumeHint(sessionId)}`);
    await subscribeToIssue(n, issue);
    // Essential, not verbose: the Melvin comparison is the point of the draft,
    // and it is the only place that verdict surfaces now that the Claude review
    // gate is off.
    await notify(armedMessage({ n, title: issue.title, issueUrl, body, verdict }), {
      replyMarkup: runAnalysisButtons(n, issueUrl),
    });
    const hasHW = labelNames(issue.labels).includes(TRIGGER);
    if (DIRECT_POST && hasHW && settings.autoPost) {
      await directPost(armed, issue, body);
    }
    return armed;
  }

  // Interim already in place — replace its body with the full draft, wherever
  // the interim now lives (still armed, or already posted by the sniper).
  const current = await supabaseRequest(
    `proposals?${new URLSearchParams({ id: `eq.${claimed.id}`, user_id: `eq.${SUPABASE_USER_ID}`, select: '*' })}`,
  );
  const row = Array.isArray(current) ? current[0] : null;
  if (!row) return null;

  if (row.state === 'armed') {
    const updated = await updateProposal(
      claimed.id,
      { state: 'armed', body, last_error: null, codex_session_id: sessionId },
      { requireState: 'armed' },
    );
    if (updated) log(`📝 #${n} full draft swapped into the armed interim (${body.length} chars)`);
    return updated || row;
  }
  if (row.state === 'posted' && row.github_comment_id) {
    const { status } = await gh(`/repos/${REPO}/issues/comments/${row.github_comment_id}`, {
      method: 'PATCH',
      body: { body },
    });
    if (status === 200) {
      await updateProposal(claimed.id, { codex_session_id: sessionId });
      log(`📝 #${n} full draft edited into the posted interim comment (proposal-police may flag it)`);
      await notify(`📝 Upgraded ${REPO}#${n} from interim to full draft on the posted comment.${resumeHint(sessionId)}`, { level: 'verbose' });
    } else {
      log(`#${n} full-draft comment edit failed (${status}) — interim stays posted`);
    }
    return row;
  }
  log(`#${n} full draft ready but row is '${row.state}' — leaving interim in place`);
  return row;
}

// Draft, validate, and retry once with validator feedback. Returns
// { body, sessionId } on success, or null after handling the failure path.
// When keepArmedOnFail is set (an interim proposal is already armed), failures
// leave the row untouched — the interim stays armed rather than dropping to
// draft/queued — so we never lose an armable proposal to a slow/failed full pass.
async function draftWithValidation(prompt, row, { keepArmedOnFail = false } = {}) {
  const n = row.issue_number;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const draft = await runCodex(
      attempt === 1 ? prompt : `${prompt}\n\n## Fix these problems from your last attempt\n${row._lastProblems}`,
      { threadName: `tasker-${n}`, marker: `Issue #${n}:` },
    );
    if (!draft.ok) {
      if (draft.usageLimited) {
        backoffUntil = Date.now() + 15 * 60_000;
        if (keepArmedOnFail) {
          log(`⏸️  #${n} full draft usage-limited — interim stays armed, backing off 15m`);
        } else {
          await updateProposal(row.id, { state: 'queued', last_error: 'Codex usage limit; will retry.' });
          log(`⏸️  #${n} Codex usage-limited — re-queued, backing off 15m`);
          await notify(`⏸️ Codex usage limit hit while drafting ${REPO}#${n}; re-queued.`);
        }
        return null;
      }
      // A timeout won't get better on retry — it'll just burn another full
      // CODEX_TIMEOUT_MS. Treat it as terminal (drop to draft) rather than
      // re-queueing for up to MAX_DRAFT_ATTEMPTS.
      const isTimeout = /timed out/i.test(draft.error);
      if (keepArmedOnFail) {
        log(`#${n} full draft failed (${draft.error}) — interim stays armed`);
      } else {
        await failDraft(row, draft.error, { terminal: isTimeout });
      }
      return null;
    }
    const { body, verdict } = splitMelvinVerdict(draft.body);
    const problems = await validateProposal(body);
    if (problems.length === 0) return { body, sessionId: draft.sessionId, verdict };
    log(`⚠️  #${n} validation failed (attempt ${attempt}): ${problems.join('; ')}`);
    row._lastProblems = problems.map((p) => `- ${p}`).join('\n');
    if (attempt === 2) {
      if (keepArmedOnFail) {
        log(`#${n} full draft failed validation twice — interim stays armed`);
      } else {
        await updateProposal(row.id, {
          state: 'draft',
          body, // keep the best attempt for a human to rescue
          last_error: `Auto-draft failed validation: ${problems.join('; ')}`.slice(0, 300),
        });
        await notify(`⚠️ Auto-draft for ${REPO}#${n} failed validation — needs a human.\nhttps://github.com/${REPO}/issues/${n}`);
      }
      return null;
    }
  }
  return null;
}

async function failDraft(row, error, { terminal = false, requireState } = {}) {
  const n = row.issue_number;
  const attempts = (row.draft_attempts || 0) + 1;
  if (terminal || attempts >= MAX_DRAFT_ATTEMPTS) {
    await updateProposal(row.id, {
      state: 'draft',
      last_error: `${terminal ? 'Auto-draft stopped' : `Auto-draft failed ${attempts}×`}: ${error}`.slice(0, 300),
      draft_attempts: attempts,
    }, { requireState });
    log(`❌ #${n} ${terminal ? 'terminal error' : `gave up after ${attempts} attempts`}: ${error}`);
    await notify(`❌ Auto-draft for ${REPO}#${n} stopped (${error.slice(0, 80)}); dropped to draft.`);
  } else {
    await updateProposal(row.id, {
      state: 'queued',
      last_error: error.slice(0, 300),
      draft_attempts: attempts,
    }, { requireState });
    log(`↻ #${n} draft error (attempt ${attempts}), re-queued: ${error}`);
  }
}

async function directPost(row, issue, body) {
  const n = row.issue_number;
  const claimed = await updateProposal(row.id, { state: 'posting' }, { requireState: 'armed' });
  if (!claimed) {
    log(`#${n} direct-post skipped — not armed`);
    return;
  }
  const { status, data } = await gh(`/repos/${REPO}/issues/${n}/comments`, {
    method: 'POST',
    body: { body },
  });
  if (status === 201 && data?.html_url) {
    await updateProposal(row.id, {
      state: 'posted',
      github_comment_id: data.id,
      posted_at: new Date().toISOString(),
      last_error: null,
    });
    log(`✅ #${n} direct-posted → ${data.html_url}`);
    await notify(`✅ Direct-posted ${REPO}#${n} (already Help Wanted)\n${data.html_url}`);
  } else {
    const detail = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data ?? null).slice(0, 200);
    await updateProposal(row.id, { state: 'armed', last_error: `Direct post failed: ${status} ${detail}`.slice(0, 300) });
    log(`❌ #${n} direct-post failed: ${status} ${detail}`);
  }
}

// ── enrichment (Phase C) ─────────────────────────────────────────────────────
async function enrichOne(id, n, currentBody) {
  const template = await readFile(ENRICH_PROMPT_FILE, 'utf8');
  const prompt = template.replace('<<<CURRENT_PROPOSAL>>>', currentBody);
  await refreshRepo();
  const draft = await runCodex(prompt, { threadName: `tasker-${n}-enrich` });
  if (!draft.ok) {
    log(`enrich #${n} skipped: ${draft.error}`);
    return;
  }
  draft.body = splitMelvinVerdict(draft.body).body;
  const problems = await validateProposal(draft.body);
  if (problems.length) {
    log(`enrich #${n} discarded — validation failed: ${problems.join('; ')}`);
    return;
  }
  if (DRY_RUN) {
    log(`🧪 DRY_RUN #${n}: would enrich (${draft.body.length} chars)`);
    return;
  }

  // Re-read current state: if still armed, patch the body; if already posted,
  // edit the live GitHub comment. State-filtered so we never clobber a post.
  const current = await supabaseRequest(
    `proposals?${new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${SUPABASE_USER_ID}`, select: '*' })}`,
  );
  const row = Array.isArray(current) ? current[0] : null;
  if (!row) return;

  if (row.state === 'armed') {
    const updated = await updateProposal(
      id,
      { state: 'armed', body: draft.body, enriched_at: new Date().toISOString(), codex_session_id: draft.sessionId },
      { requireState: 'armed' },
    );
    if (updated) {
      log(`🧬 #${n} enriched (armed body updated)${draft.sessionId ? ` [codex ${draft.sessionId}]` : ''}`);
      await notify(`🧬 Enriched ${REPO}#${n} — stronger RCA + permalinks.${resumeHint(draft.sessionId)}`);
    }
  } else if (row.state === 'posted' && row.github_comment_id) {
    const { status } = await gh(`/repos/${REPO}/issues/comments/${row.github_comment_id}`, {
      method: 'PATCH',
      body: { body: draft.body },
    });
    if (status === 200) {
      await updateProposal(id, { enriched_at: new Date().toISOString(), codex_session_id: draft.sessionId });
      log(`🧬 #${n} enriched (posted comment edited)${draft.sessionId ? ` [codex ${draft.sessionId}]` : ''}`);
      await notify(`🧬 Enriched posted comment on ${REPO}#${n}.${resumeHint(draft.sessionId)}`);
    } else {
      log(`enrich #${n}: comment edit failed (${status})`);
    }
  }
}

// ── session-id backfill ──────────────────────────────────────────────────────
// One-shot at boot: proposals drafted before rollout-based capture (every
// codex_session_id was null — see the comment on rolloutFiles) get their id
// recovered from the rollout files already on the volume. Draft prompts embed
// "Issue #<n>: <title>", so each rollout attributes itself; the newest session
// per issue wins, matching the row's latest body.
async function backfillCodexSessionIds() {
  const query = new URLSearchParams({
    user_id: `eq.${SUPABASE_USER_ID}`,
    repo_owner: `ilike.${REPO_OWNER}`,
    repo_name: `ilike.${REPO_NAME}`,
    codex_session_id: 'is.null',
    select: 'id,issue_number',
  });
  const rows = await supabaseRequest(`proposals?${query}`);
  if (!Array.isArray(rows) || rows.length === 0) return;
  const newestByIssue = new Map(); // issue → { id, mtime }
  for (const r of await rolloutFiles()) {
    const m = /Issue #(\d+):/.exec(await rolloutHead(r.file).catch(() => ''));
    if (!m) continue;
    const n = Number(m[1]);
    let mtime = 0;
    try {
      mtime = statSync(r.file).mtimeMs;
    } catch {
      continue;
    }
    const prev = newestByIssue.get(n);
    if (!prev || mtime > prev.mtime) newestByIssue.set(n, { id: r.id, mtime });
  }
  let filled = 0;
  for (const row of rows) {
    const hit = newestByIssue.get(row.issue_number);
    if (!hit) continue;
    await updateProposal(row.id, { codex_session_id: hit.id });
    filled++;
  }
  log(`🧾 codex session backfill: ${filled}/${rows.length} row(s) recovered from ${newestByIssue.size} attributable rollout(s)`);
}

// ── stale recovery ───────────────────────────────────────────────────────────
async function recoverStaleDrafting() {
  if (Date.now() - lastStaleSweepAt < STALE_SWEEP_MS) return;
  lastStaleSweepAt = Date.now();
  const cutoff = new Date(Date.now() - STALE_DRAFTING_MS).toISOString();
  const query = new URLSearchParams({
    user_id: `eq.${SUPABASE_USER_ID}`,
    state: 'eq.drafting',
    updated_at: `lt.${cutoff}`,
    select: 'issue_number',
  });
  try {
    const rows = await supabaseRequest(`proposals?${query}`, {
      method: 'PATCH',
      body: { state: 'queued', last_error: 'Recovered stale drafting claim after a worker restart.' },
      prefer: 'return=representation',
    });
    if (Array.isArray(rows) && rows.length) {
      log(`♻️  re-queued ${rows.length} stale drafting row(s): ${rows.map((r) => `#${r.issue_number}`).join(', ')}`);
    }
  } catch (e) {
    log(`stale sweep failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── wasted-draft telemetry ─────────────────────────────────────────────────────
// Aggregate the outcome of auto-drafted proposals from DB state alone, over 24h
// and 7d trailing windows, and log (+ Telegram) the Help-Wanted reach rate. No
// GitHub calls: `posted` means HW arrived and the sniper raced it; `armed` past
// WASTE_STALE_ARMED_MS with the issue still tracked means HW almost certainly
// never came (wasted deep draft); `draft` is a validation/again failure.
async function wasteReport(force = false) {
  if (!WASTE_REPORT_ENABLED) return;
  if (!force && Date.now() - lastWasteReportAt < WASTE_REPORT_INTERVAL_MS) return;
  lastWasteReportAt = Date.now();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const query = new URLSearchParams({
    user_id: `eq.${SUPABASE_USER_ID}`,
    repo_owner: `ilike.${REPO_OWNER}`,
    repo_name: `ilike.${REPO_NAME}`,
    origin: 'eq.auto',
    created_at: `gte.${since7d}`,
    select: 'state,created_at',
  });
  let rows;
  try {
    rows = await supabaseRequest(`proposals?${query}`);
  } catch (e) {
    log(`waste report query failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!Array.isArray(rows)) return;

  const now = Date.now();
  const day = now - 24 * 60 * 60_000;
  const bucket = (list) => {
    const b = { drafted: 0, posted: 0, armedPending: 0, armedWasted: 0, dropped: 0, queuedOrDrafting: 0 };
    for (const r of list) {
      const ageMs = now - Date.parse(r.created_at || '');
      switch (r.state) {
        case 'posted': b.drafted++; b.posted++; break;
        case 'armed':
          b.drafted++;
          if (ageMs > WASTE_STALE_ARMED_MS) b.armedWasted++;
          else b.armedPending++;
          break;
        case 'draft': b.drafted++; b.dropped++; break; // validation/fail drop-outs
        default: b.queuedOrDrafting++; break; // in-flight, not yet an outcome
      }
    }
    return b;
  };
  const fmt = (b, label) => {
    const resolved = b.posted + b.armedWasted + b.dropped; // outcomes we can call
    const reach = resolved ? Math.round((b.posted / resolved) * 100) : 0;
    return (
      `${label}: ${b.drafted} drafted | ✅ ${b.posted} posted (HW reached) | ` +
      `🗑️ ${b.armedWasted} armed-no-HW | ⏳ ${b.armedPending} armed-pending | ` +
      `⚠️ ${b.dropped} dropped | HW-reach ${reach}% of resolved`
    );
  };
  const d = bucket(rows.filter((r) => Date.parse(r.created_at || '') >= day));
  const w = bucket(rows);
  const line = `📊 auto-draft waste report\n  ${fmt(d, '24h')}\n  ${fmt(w, '7d ')}`;
  log(line.replace(/\n\s*/g, ' | '));
  await notify(line, { level: 'verbose' });
}

// ── main loop ────────────────────────────────────────────────────────────────
// Both toggles in one read: `autopilot_enabled` (the "Auto-pilot" checkbox) gates
// DRAFTING; `proposal_auto_post` (the "Auto-post on Help Wanted" checkbox + the
// sniper) gates POSTING. Absent row/field defaults to on.
async function fetchSettings() {
  const query = new URLSearchParams({
    select: 'proposal_auto_post,autopilot_enabled',
    id: `eq.${SUPABASE_USER_ID}`,
    limit: '1',
  });
  const rows = await supabaseRequest(`user_settings?${query}`);
  const s = Array.isArray(rows) ? rows[0] : null;
  return {
    autoPost: !s || s.proposal_auto_post !== false,
    autoPilot: !s || s.autopilot_enabled !== false,
  };
}

// Pick which queued rows to draft now. A row is ready once `External` is on the
// issue, or once it has waited DRAFT_DELAY_MS without it. Newest first, so a
// burst spends its slots on the issues whose race is still winnable.
async function selectReady(candidates, slots) {
  const ready = [];
  let checks = 0;
  for (const row of candidates) {
    if (ready.length >= slots) break;
    if (row.force_draft) {
      ready.push(row); // explicit click — never waits
      continue;
    }
    const waitedMs = Date.now() - Date.parse(row.created_at);
    if (!Number.isFinite(waitedMs) || waitedMs >= DRAFT_DELAY_MS) {
      if (DRAFT_DELAY_MS > 0) log(`⏱️  #${row.issue_number} gave up waiting for "${LOCK}" — drafting anyway`);
      ready.push(row);
      continue;
    }
    if (checks >= MAX_LABEL_CHECKS_PER_TICK) continue;
    checks++;
    const { status, data } = await gh(`/repos/${REPO}/issues/${row.issue_number}`);
    if (status !== 200 || !data) continue; // unknown — let the next poll decide
    if (labelNames(data.labels).includes(LOCK)) ready.push(row);
  }
  return ready;
}

async function tick() {
  if (!AUTOPILOT_ENABLED) return; // Railway master switch — idle when off
  if (Date.now() < backoffUntil) return;
  await recoverStaleDrafting();
  void wasteReport(); // throttled internally; DB-only, safe to call every tick
  const slots = MAX_CONCURRENT_DRAFTS - draftsInFlight;
  if (slots <= 0) return; // all drafting slots busy — check again next poll
  const settings = await fetchSettings();
  // The Auto-pilot checkbox gates the automatic stream, not an explicit
  // per-issue click (force_draft) — otherwise the button would silently queue
  // work nothing ever picks up.
  const forceOnly = !settings.autoPilot;

  const query = new URLSearchParams({
    // Only the columns draftOne needs — the drafter writes the body, it never
    // reads the existing one, so don't pull it across the wire on every poll.
    select: 'id,issue_number,draft_attempts,state,origin,created_at,force_draft',
    user_id: `eq.${SUPABASE_USER_ID}`,
    repo_owner: `ilike.${REPO_OWNER}`,
    repo_name: `ilike.${REPO_NAME}`,
    state: 'eq.queued',
    origin: 'eq.auto',
    // Newest first: in a mass-labeling burst the freshest issue has the most
    // valuable race window still open; a stale backlog item has already lost
    // its minutes either way. (Was oldest-first, which polished stale issues
    // while fresh Help Wanted windows slipped by.)
    order: 'created_at.desc',
    // Over-fetch: rows still waiting on `External` are skipped below, so the
    // window has to be wider than the slots we're trying to fill.
    limit: String(forceOnly ? slots : slots + MAX_LABEL_CHECKS_PER_TICK),
  });
  if (forceOnly) query.set('force_draft', 'eq.true');
  const candidates = await supabaseRequest(`proposals?${query}`);
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  if (forceOnly) {
    log(`▶️  Auto-pilot off — drafting ${candidates.length} explicitly requested issue(s): ${candidates.map((r) => `#${r.issue_number}`).join(', ')}`);
  }
  const rows = forceOnly ? candidates : await selectReady(candidates, slots);
  if (rows.length === 0) return;
  // Fire drafts without awaiting so the poll loop keeps running and can fill
  // freed slots. The queued→drafting claim is atomic (state-filtered PATCH), so
  // a row can never be drafted twice even if it were fetched twice.
  for (const row of rows) {
    draftsInFlight++;
    void draftOne(row, settings)
      .catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log(`draft #${row.issue_number} crashed: ${msg}`);
        // Count it as an attempt. Errors that escape draftOne — spawn failures
        // throw synchronously, so E2BIG never reached the paths that call
        // failDraft — used to leave the row in `drafting` for the stale sweeper
        // to re-queue with draft_attempts untouched, so MAX_DRAFT_ATTEMPTS could
        // never trip and #96956 crash-looped every 30 min for a day.
        // requireState pins it to `drafting`: a crash after the draft already
        // armed must not drag the row back to queued.
        try {
          await failDraft(row, `crashed: ${msg}`, { requireState: 'drafting' });
        } catch (inner) {
          log(`draft #${row.issue_number} fail-bookkeeping failed: ${inner instanceof Error ? inner.message : String(inner)}`);
        }
      })
      .finally(() => {
        draftsInFlight--;
        draftsSinceBoot++;
        lastDraftEndedAt = Date.now();
        // Codex output and issue payloads are parsed as one big string each, so
        // the heap ends a draft far above its working set. Compacting here (the
        // container runs node --expose-gc) returns it before the idle stretch
        // that Railway meters.
        if (draftsInFlight === 0 && typeof global.gc === 'function') global.gc();
      });
  }
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (shouldRecycle()) {
    log(`♻️  idle ${Math.round((Date.now() - lastDraftEndedAt) / 60_000)}m after ${draftsSinceBoot} draft(s) — exiting to release memory`);
    process.exit(0);
  }
  setTimeout(() => void loop(), POLL_INTERVAL_MS);
}

// Only recycle with no draft in flight: a claimed row would otherwise sit in
// `drafting` until the stale sweeper reclaims it, wasting the race window it was
// queued for.
function shouldRecycle() {
  if (IDLE_RESTART_MS <= 0 || draftsSinceBoot === 0 || draftsInFlight > 0) return false;
  return Date.now() - lastDraftEndedAt >= IDLE_RESTART_MS;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_USER_ID) {
    console.error('drafter requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_USER_ID');
    process.exit(1);
  }
  await ensureCodexAuth();
  await installSkills();
  await ensureRepo();
  await backfillCodexSessionIds().catch((e) =>
    log(`codex session backfill failed (continuing): ${e instanceof Error ? e.message : String(e)}`),
  );
  log(
    `drafter up — repo=${REPO} skill=${SKILL_NAME} autopilot=${AUTOPILOT_ENABLED ? 'on' : 'OFF'} ` +
      `dryRun=${DRY_RUN} enrich=${ENRICH ? 'on' : 'off'} ` +
      `directPost=${DIRECT_POST ? 'on' : 'off'} poll=${POLL_INTERVAL_MS}ms ` +
      `concurrency=${MAX_CONCURRENT_DRAFTS} ` +
      `wait=${DRAFT_DELAY_MS ? `${Math.round(DRAFT_DELAY_MS / 60_000)}m for "${LOCK}"` : 'off'} ` +
      `model=${CODEX_MODEL || 'account-default'} telegram=${TG_TOKEN && TG_CHAT ? 'on' : 'off'}`,
  );
  void wasteReport(true).catch(() => {}); // one report at boot; then hourly from the loop
  void loop();
}

// ── helpers ───────────────────────────────────────────────────────────────────
function int(k, d) {
  const v = process.env[k];
  return v ? parseInt(v, 10) : d;
}
function bool(k, d) {
  const v = process.env[k];
  if (v == null) return d;
  return /^(1|true|yes|on)$/i.test(v);
}

main();
