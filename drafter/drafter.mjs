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

import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
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
const STALE_DRAFTING_MS = int('STALE_DRAFTING_MS', 30 * 60_000); // reclaim after 30 min
const STALE_SWEEP_MS = int('STALE_SWEEP_MS', 60_000);
const MAX_DRAFT_ATTEMPTS = int('MAX_DRAFT_ATTEMPTS', 3);

const DRAFT_PROMPT_FILE = process.env.DRAFT_PROMPT_FILE || path.join(HERE, 'prompts', 'draft.md');
const ENRICH_PROMPT_FILE = process.env.ENRICH_PROMPT_FILE || path.join(HERE, 'prompts', 'enrich.md');

// ── state ───────────────────────────────────────────────────────────────────
let backoffUntil = 0; // Codex usage-limit backoff
let lastStaleSweepAt = 0;
const dryRunSeen = new Set(); // issues already dry-drafted this process (no re-loop)

// ── logging + telegram ────────────────────────────────────────────────────────
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function notify(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const res = await fetch(`${TG_API}/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
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
// Read the session Codex just recorded. It appends one {id, thread_name, ...}
// line to CODEX_HOME/session_index.jsonl per run; the drafter runs codex one at
// a time, so the newest line after the run is this session. Returns null if the
// index isn't present (e.g. an old Codex, or --ephemeral).
async function latestCodexSession() {
  try {
    const raw = await readFile(path.join(CODEX_HOME, 'session_index.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        if (row?.id) return { id: row.id, threadName: row.thread_name || '' };
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* no index */
  }
  return null;
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

async function runCodex(prompt, { threadName } = {}) {
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
  if (CODEX_MODEL) args.push('-m', CODEX_MODEL);
  // Best-effort: label the session by issue. `codex exec` currently ignores this
  // (it assigns an auto-incrementing name), but we read the real id back either
  // way, so this just helps if a future Codex honors it.
  if (threadName) args.push('-c', `thread_name=${JSON.stringify(threadName)}`);
  args.push(prompt);

  const res = await runCodexProcess(CODEX_BIN, args, {
    env: codexSubprocessEnv(),
    timeoutMs: CODEX_TIMEOUT_MS,
    outFile,
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
    if (res.timedOut) return { ok: false, error: `codex timed out after ${CODEX_TIMEOUT_MS}ms` };
    if (res.code != null && res.code !== 0) {
      return { ok: false, error: `codex exited ${res.code}: ${res.stderr.slice(0, 300)}` };
    }
    body = res.stdout.trim(); // last-resort fallback
  }
  if (!body) return { ok: false, error: 'codex produced an empty proposal' };
  const session = await latestCodexSession();
  return { ok: true, body, sessionId: session?.id || null };
}

// Run `codex exec`, but stop waiting the moment it writes its final proposal to
// --output-last-message. Codex often completes the task in ~1–2 min yet the
// process keeps running (lingering web-search / telemetry handles); without this
// it would sit until CODEX_TIMEOUT_MS, get SIGKILLed, and the finished draft would
// be discarded as a "timeout". Once the output file is non-empty we let it flush
// briefly, then kill the process and resolve — the caller reads the file.
function runCodexProcess(cmd, args, { env, timeoutMs, outFile } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      // env is a complete, pre-scrubbed environment (see codexSubprocessEnv) — do
      // NOT merge process.env back in, or the secrets we removed would return.
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

async function buildDraftPrompt(issue, comments) {
  const template = await readFile(DRAFT_PROMPT_FILE, 'utf8');
  const commentText = (comments || [])
    .slice(0, 20)
    .map((c) => `--- comment by ${c.user?.login || '?'} ---\n${c.body || ''}`)
    .join('\n\n');
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
  const { data: comments } = await gh(`/repos/${REPO}/issues/${n}/comments?per_page=30`);

  const prompt = await buildDraftPrompt(issue, Array.isArray(comments) ? comments : []);
  const result = await draftWithValidation(prompt, claimed);
  if (!result) return; // failure paths handled inside

  const { body, sessionId } = result;

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

  // Arm: drafting → armed. The sniper stages it and posts on Help Wanted.
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
    return;
  }
  const issueUrl = `https://github.com/${REPO}/issues/${n}`;
  log(`📝 #${n} armed${sessionId ? ` [codex ${sessionId}]` : ''}`);
  // Keep the ping short — no full proposal in Telegram. Just the issue, a size
  // hint, and the resume command to open it in the extension/terminal.
  await notify(
    `📝 Draft ready & auto-armed — ${REPO}#${n}\n${issue.title}\n${issueUrl}` +
      `\n(${body.length} chars, validated)${resumeHint(sessionId)}`,
  );

  // Fast path: if Help Wanted is already on the issue, the sniper intentionally
  // ignores the stale label event, so post directly.
  // Direct-post is POSTING, so it obeys the "Auto-post on Help Wanted" toggle —
  // even though drafting itself is gated by the separate "Auto-pilot" toggle.
  const hasHW = labelNames(issue.labels).includes(TRIGGER);
  if (DIRECT_POST && hasHW && settings.autoPost) {
    await directPost(armed, issue, body);
  }

  if (ENRICH) {
    await enrichOne(armed.id, n, body);
  }
}

// Draft, validate, and retry once with validator feedback. Returns
// { body, sessionId } on success, or null after handling the failure path.
async function draftWithValidation(prompt, row) {
  const n = row.issue_number;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const draft = await runCodex(
      attempt === 1 ? prompt : `${prompt}\n\n## Fix these problems from your last attempt\n${row._lastProblems}`,
      { threadName: `tasker-${n}` },
    );
    if (!draft.ok) {
      if (draft.usageLimited) {
        backoffUntil = Date.now() + 15 * 60_000;
        await updateProposal(row.id, { state: 'queued', last_error: 'Codex usage limit; will retry.' });
        log(`⏸️  #${n} Codex usage-limited — re-queued, backing off 15m`);
        await notify(`⏸️ Codex usage limit hit while drafting ${REPO}#${n}; re-queued.`);
        return null;
      }
      // A timeout won't get better on retry — it'll just burn another full
      // CODEX_TIMEOUT_MS. Treat it as terminal (drop to draft) rather than
      // re-queueing for up to MAX_DRAFT_ATTEMPTS.
      const isTimeout = /timed out/i.test(draft.error);
      await failDraft(row, draft.error, { terminal: isTimeout });
      return null;
    }
    const problems = await validateProposal(draft.body);
    if (problems.length === 0) return { body: draft.body, sessionId: draft.sessionId };
    log(`⚠️  #${n} validation failed (attempt ${attempt}): ${problems.join('; ')}`);
    row._lastProblems = problems.map((p) => `- ${p}`).join('\n');
    if (attempt === 2) {
      await updateProposal(row.id, {
        state: 'draft',
        body: draft.body, // keep the best attempt for a human to rescue
        last_error: `Auto-draft failed validation: ${problems.join('; ')}`.slice(0, 300),
      });
      await notify(`⚠️ Auto-draft for ${REPO}#${n} failed validation — needs a human.\nhttps://github.com/${REPO}/issues/${n}`);
      return null;
    }
  }
  return null;
}

async function failDraft(row, error, { terminal = false } = {}) {
  const n = row.issue_number;
  const attempts = (row.draft_attempts || 0) + 1;
  if (terminal || attempts >= MAX_DRAFT_ATTEMPTS) {
    await updateProposal(row.id, {
      state: 'draft',
      last_error: `${terminal ? 'Auto-draft stopped' : `Auto-draft failed ${attempts}×`}: ${error}`.slice(0, 300),
      draft_attempts: attempts,
    });
    log(`❌ #${n} ${terminal ? 'terminal error' : `gave up after ${attempts} attempts`}: ${error}`);
    await notify(`❌ Auto-draft for ${REPO}#${n} stopped (${error.slice(0, 80)}); dropped to draft.`);
  } else {
    await updateProposal(row.id, {
      state: 'queued',
      last_error: error.slice(0, 300),
      draft_attempts: attempts,
    });
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

async function tick() {
  if (!AUTOPILOT_ENABLED) return; // Railway master switch — idle when off
  if (Date.now() < backoffUntil) return;
  await recoverStaleDrafting();
  const settings = await fetchSettings();
  if (!settings.autoPilot) return; // "Auto-pilot" checkbox off — draft nothing

  const query = new URLSearchParams({
    // Only the columns draftOne needs — the drafter writes the body, it never
    // reads the existing one, so don't pull it across the wire on every poll.
    select: 'id,issue_number,draft_attempts,state,origin,created_at',
    user_id: `eq.${SUPABASE_USER_ID}`,
    repo_owner: `ilike.${REPO_OWNER}`,
    repo_name: `ilike.${REPO_NAME}`,
    state: 'eq.queued',
    origin: 'eq.auto',
    order: 'created_at.asc',
    limit: '1',
  });
  const rows = await supabaseRequest(`proposals?${query}`);
  if (!Array.isArray(rows) || rows.length === 0) return;
  await draftOne(rows[0], settings);
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  setTimeout(() => void loop(), POLL_INTERVAL_MS);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_USER_ID) {
    console.error('drafter requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_USER_ID');
    process.exit(1);
  }
  await ensureCodexAuth();
  await installSkills();
  await ensureRepo();
  log(
    `drafter up — repo=${REPO} skill=${SKILL_NAME} autopilot=${AUTOPILOT_ENABLED ? 'on' : 'OFF'} ` +
      `dryRun=${DRY_RUN} enrich=${ENRICH ? 'on' : 'off'} ` +
      `directPost=${DIRECT_POST ? 'on' : 'off'} poll=${POLL_INTERVAL_MS}ms ` +
      `model=${CODEX_MODEL || 'account-default'} telegram=${TG_TOKEN && TG_CHAT ? 'on' : 'off'}`,
  );
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
