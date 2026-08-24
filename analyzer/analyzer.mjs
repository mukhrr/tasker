#!/usr/bin/env node
/**
 * Tasker analyzer — local "Run Claude analysis" worker.
 *
 * Runs ON YOUR MAC (not Railway): it needs your Claude Code subscription auth,
 * your local Expensify/App checkout, and produces a local git stash you'll pop
 * when you win the assignment.
 *
 * Flow per request (queued from the extension's 🧠 button):
 *   claim queued→running → preflight (checkout must be clean) → build prompt
 *   (issue + current proposal) → `claude -p` headless with
 *   --dangerously-skip-permissions in the App checkout (reproduce with
 *   Playwright, implement the minimal fix, NO commits) → parse SUMMARY/PROPOSAL
 *   from the output → update the posted GitHub comment (or the Supabase draft)
 *   → `git stash push` ONLY the files the run changed → Telegram ping → done.
 *
 * Start:  cd analyzer && cp .env.example .env  (fill it in)
 *         node --env-file=.env analyzer.mjs
 */

import { readFile, writeFile, readdir, open, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── config ───────────────────────────────────────────────────────────────────
const REPO = process.env.REPO || 'Expensify/App';
const [REPO_OWNER, REPO_NAME] = REPO.split('/');
const APP_REPO_DIR = process.env.APP_REPO_DIR || path.join(homedir(), 'Documents', 'App');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_USER_ID = process.env.SUPABASE_USER_ID || '';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''; // for reading the issue + updating the posted comment
const GITHUB_API = 'https://api.github.com';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

// Base mailbox for web-repro sign-UPS: each run joins with a brand-new
// +suffix address (fresh account → "Join" button → no magic code needed).
// Injected into the PROMPT, not the subprocess env.
const TEST_ACCOUNT_EMAIL = process.env.TEST_ACCOUNT_EMAIL || '';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || ''; // '' → CLI default; subscription auth either way
const CLAUDE_TIMEOUT_MS = int('CLAUDE_TIMEOUT_MS', 45 * 60_000); // repro + fix can legitimately take a while
const JEST_TIMEOUT_MS = int('JEST_TIMEOUT_MS', 10 * 60_000); // per red/green jest run
const REPRO_TIMEOUT_MS = int('REPRO_TIMEOUT_MS', 3 * 60_000); // per fast-replay run
// After reverting/re-applying src files, the dev server needs a moment to
// rebuild before a replay reflects the new tree (rsbuild HMR, ~3s typical).
const REBUILD_WAIT_MS = int('REBUILD_WAIT_MS', 10_000);
const PW_PROFILE_DIR = process.env.PW_PROFILE_DIR || path.join(homedir(), '.tasker', 'pw-profile');
const REPRO_MCP_CONFIG = path.join(HERE, 'repro-mcp.json');
const POLL_INTERVAL_MS = int('POLL_INTERVAL_MS', 15_000);
const PROMPT_FILE = path.join(HERE, 'prompts', 'analyze.md');

// ── Melvin-review gate ────────────────────────────────────────────────────────
// After the drafter arms an auto proposal, the local Claude CLI compares it to
// MelvinBot's own proposal (posted on the issue) and either disarms duplicates
// (armed → draft, so the sniper won't race them) or keeps + Telegram-flags the
// distinct ones as worth a deep analysis. Pure text judgment — no repo work.
// Fail-open throughout: any error/timeout leaves the proposal armed.
// Off by default: the drafter now waits until MelvinBot has posted, so Codex
// compares against it during the draft itself and a second Claude pass would
// re-reach the same verdict. REVIEW_ENABLED=true restores the independent check.
const REVIEW_ENABLED = /^(1|true|yes|on)$/i.test(process.env.REVIEW_ENABLED ?? 'false');
const REVIEW_TIMEOUT_MS = int('REVIEW_TIMEOUT_MS', 5 * 60_000);
// How long after arming to wait for Melvin before treating "no Melvin proposal"
// as "Melvin won't post" (→ we're the only proposal → keep + flag).
const REVIEW_MELVIN_GRACE_MS = int('REVIEW_MELVIN_GRACE_MS', 10 * 60_000);
// Don't review a stale backlog — only proposals armed within this window.
const REVIEW_MAX_AGE_MS = int('REVIEW_MAX_AGE_MS', 24 * 60 * 60_000);
const REVIEW_PROMPT_FILE = path.join(HERE, 'prompts', 'review.md');
let reviewDisabled = false; // set if the reviewed_at column is missing (pre-migration)

let busy = false;

// ── helpers ──────────────────────────────────────────────────────────────────
function int(k, d) {
  const v = process.env[k];
  return v ? parseInt(v, 10) : d;
}
function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function notify(text, { replyMarkup } = {}) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
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
    if (!res.ok) log(`telegram err: ${res.status}`);
  } catch (e) {
    log(`telegram err: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Inline keyboard for a review "kept" ping: a callback button that queues the
// deep analysis (handled by the getUpdates listener) + a plain link to the issue.
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

// ── Telegram callback listener (Run-analysis button) ─────────────────────────
// Only the daemon long-polls getUpdates (the sniper/drafter are send-only), so
// there's no multi-consumer conflict. Runs independently of the analysis `busy`
// lock — a press just queues an analysis_requests row the main loop then claims.
let tgOffset = 0;
async function tgGetUpdates(offset, timeoutSec) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset, timeout: timeoutSec, allowed_updates: ['callback_query'] }),
    signal: AbortSignal.timeout((timeoutSec + 10) * 1000),
  });
  const j = await res.json().catch(() => null);
  return j?.ok && Array.isArray(j.result) ? j.result : [];
}
async function tgApi(method, body) {
  return fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
}

async function queueAnalysisFromTelegram(n) {
  // Upsert to queued (mirror the extension's "Run Claude analysis" / re-run).
  await supabaseRequest(`analysis_requests?on_conflict=user_id,repo_owner,repo_name,issue_number`, {
    method: 'POST',
    body: {
      user_id: SUPABASE_USER_ID,
      repo_owner: REPO_OWNER,
      repo_name: REPO_NAME,
      issue_number: n,
      state: 'queued',
      last_error: null,
      result_summary: null,
      stash_ref: null,
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

async function handleTgUpdate(u) {
  const cb = u.callback_query;
  if (!cb) return;
  const chatId = cb.message?.chat?.id;
  if (String(chatId) !== String(TG_CHAT)) {
    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Not authorized' });
    return; // security: only act on our own chat
  }
  const m = (cb.data || '').match(/^run:(\d+)$/);
  if (!m) {
    await tgApi('answerCallbackQuery', { callback_query_id: cb.id });
    return;
  }
  const n = parseInt(m[1], 10);
  try {
    await queueAnalysisFromTelegram(n);
    log(`📲 queued deep analysis for #${n} via Telegram button`);
    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `Queued deep analysis for #${n} ✓` });
    // Replace the button so it can't be pressed twice; leave a link to the issue.
    await tgApi('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: `✅ Deep analysis queued for #${n}`, url: `https://github.com/${REPO}/issues/${n}` }]] },
    });
  } catch (e) {
    await tgApi('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: `Failed to queue: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`,
    });
  }
}

async function tgUpdatesLoop() {
  if (!TG_TOKEN || !TG_CHAT) return; // no bot configured
  try {
    // Drain updates pending at boot so a restart doesn't re-fire an old press.
    const stale = await tgGetUpdates(0, 0);
    if (stale.length) tgOffset = stale[stale.length - 1].update_id + 1;
  } catch {
    /* ignore */
  }
  log('📲 Telegram Run-analysis button listener active');
  const poll = async () => {
    try {
      const updates = await tgGetUpdates(tgOffset, 25);
      for (const u of updates) {
        tgOffset = u.update_id + 1;
        try {
          await handleTgUpdate(u);
        } catch (e) {
          log(`tg update failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch {
      /* transient (network / 409) — retry */
    }
    setTimeout(poll, 500);
  };
  void poll();
}

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
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${pathname} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function gh(pathname, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tasker-analyzer' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, data };
}

// Kill a child AND its whole process tree. claude spawns MCP servers
// (playwright/chrome-devtools/context7) as grandchildren; a plain child.kill
// only reaps claude and ORPHANS those helpers — they piled up across days of
// timed-out/canceled runs and spiked CPU (2026-07-27). Because run() spawns
// detached (own process group = pid), signalling -pid reaps the whole group.
function killTree(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, 'SIGKILL'); // negative pid = the process group
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

// `resolveOnJson` (used for `claude -p --output-format json`): finish as soon as
// stdout holds the complete result object, instead of waiting for the process to
// exit. claude keeps its MCP servers (playwright/chrome-devtools/context7/
// repro-mcp) alive after printing the result, so the process can linger for the
// full timeout with the work already DONE — the row stays 'running', the widget
// shows "Analyzing…" forever, and the finished analysis is finally discarded as
// a timeout (seen on #97156: SUMMARY emitted at 07:09, process still alive
// 20+ min later). Same fix the drafter already has for codex (runCodexProcess).
function run(cmd, args, { cwd, env, timeoutMs, input, onChild, resolveOnJson = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env || process.env,
      stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: true, // own process group so killTree() can reap MCP/child processes
    });
    if (onChild) onChild(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let lingerTimer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (lingerTimer) clearTimeout(lingerTimer);
      resolve(r);
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, timeoutMs)
      : null;
    child.stdout.on('data', (c) => {
      stdout += c.toString();
      if (!resolveOnJson || settled || lingerTimer) return;
      // Cheap guard first — only attempt a parse once stdout looks terminated.
      if (!stdout.trimEnd().endsWith('}')) return;
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        return; // still streaming
      }
      if (!parsed || typeof parsed !== 'object' || typeof parsed.result !== 'string') return;
      // Result is in hand. Give stderr a beat to flush, then reap the tree.
      lingerTimer = setTimeout(() => {
        killTree(child);
        finish({ code: 0, stdout, stderr, timedOut: false, lingered: true });
      }, 500);
    });
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (e) => finish({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, timedOut }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }));
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

function git(args, opts = {}) {
  return run('git', args, { cwd: APP_REPO_DIR, timeoutMs: 60_000, ...opts });
}

// Claude writes its session file to ~/.claude/projects/<slug>/<session-id>.jsonl
// from session START (the id is the filename), so we can surface the resumable
// session the moment analysis begins — not only when claude exits. This watches
// for the NEW session file whose prompt contains "issue #<n>" (disambiguates
// from any interactive claude the user has open in the same checkout) and writes
// claude_session_id onto the running row, so the widget can show a copy button
// during "Analyzing…". Best-effort; the end-of-run JSON id is the fallback.
async function captureSessionEarly(reqId, n) {
  const slug = APP_REPO_DIR.replace(/\//g, '-'); // /Users/x/Documents/App → -Users-x-Documents-App
  const dir = path.join(homedir(), '.claude', 'projects', slug);
  let before;
  try {
    before = new Set(await readdir(dir));
  } catch {
    return; // project dir not created yet / unreadable
  }
  const marker = `issue #${n}`;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    let files = [];
    try {
      files = await readdir(dir);
    } catch {
      /* transient */
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl') || before.has(f)) continue;
      let head = '';
      try {
        const fh = await open(path.join(dir, f), 'r');
        const buf = Buffer.alloc(64 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        head = buf.toString('utf8', 0, bytesRead);
      } catch {
        continue;
      }
      if (head.includes(marker)) {
        const sid = f.replace(/\.jsonl$/, '');
        // requireState running: don't write onto a canceled/re-queued row.
        await updateRequest(reqId, { claude_session_id: sid }, { requireState: 'running' }).catch(() => {});
        log(`🔖 #${n} session ${sid} (captured at start)`);
        return path.join(dir, f);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// The claude run is one opaque 10-30 minute stretch from the daemon's side, but
// its session transcript records every tool call as it happens. The first edit
// to a real source file is the reproduce→fix transition; repro artifacts (test
// harnesses, .repros/ recordings, scratch scripts) are still reproduction.
const EDIT_TOOL_RE = /"name":\s*"(?:Edit|Write|MultiEdit|NotebookEdit)"/;
// File paths any Edit/Write/MultiEdit/NotebookEdit tool_use in one transcript
// line touched, normalized to repo-relative (the transcript records absolute
// paths; git status --porcelain reports repo-relative — both sides of the
// stash-time comparison need to agree on one form).
function editedFilePathsInLine(line) {
  if (!EDIT_TOOL_RE.test(line)) return [];
  const paths = [];
  const prefix = APP_REPO_DIR.endsWith('/') ? APP_REPO_DIR : `${APP_REPO_DIR}/`;
  try {
    for (const item of JSON.parse(line)?.message?.content || []) {
      if (item?.type !== 'tool_use') continue;
      if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(item.name || '')) continue;
      const p = String(item.input?.file_path || item.input?.notebook_path || '');
      if (p) paths.push(p.startsWith(prefix) ? p.slice(prefix.length) : p);
    }
  } catch {
    /* partial or non-JSON line */
  }
  return paths;
}

// Called once, after claude has exited and the transcript is complete: the
// authoritative "what did OUR session actually touch" list. Stashing used to
// diff dirty-files-now against dirty-files-at-start, which can't tell Claude's
// own edit from someone else's landing in the same 10-40 minute window — #99086
// swept in unrelated bank-account WIP from the same shared checkout because of
// exactly that gap. This reads ground truth from the tool calls themselves.
async function claudeTouchedFiles(transcript) {
  const touched = new Set();
  let text;
  try {
    text = await readFile(transcript, 'utf8');
  } catch {
    return touched; // unreadable — caller falls back to the old preDirty-only diff
  }
  for (const line of text.split('\n')) {
    for (const p of editedFilePathsInLine(line)) touched.add(p);
  }
  return touched;
}

// A live web repro against the real dev server is genuinely slow — #99000 took
// 36 minutes and 76 tool calls before its first source edit, most of it real
// work (18 iterated Playwright probe scripts, 4 retried after a TimeoutError).
// The old flat "Reproducing the bug…" gave no way to tell that from a hang, so
// count tool_use events off the same transcript tail and report growth — not
// live, just enough motion across the widget's own poll to prove it's alive.
const TOOL_USE_COUNT_RE = /"type":\s*"tool_use"/g;
const REPRO_PROGRESS_THROTTLE_MS = 20_000;
async function watchFixPhase(reqId, n, transcript, ctrl) {
  let offset = 0;
  let remainder = '';
  let toolCalls = 0;
  let lastReportedAt = 0;
  while (!ctrl.stop) {
    await new Promise((r) => setTimeout(r, 5000));
    let chunk = '';
    try {
      const fh = await open(transcript, 'r');
      const { size } = await fh.stat();
      if (size > offset) {
        const buf = Buffer.alloc(size - offset);
        const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
        offset += bytesRead;
        chunk = buf.toString('utf8', 0, bytesRead);
      }
      await fh.close();
    } catch {
      continue; // transient read failure — retry next tick
    }
    if (!chunk) continue;
    const lines = (remainder + chunk).split('\n');
    remainder = lines.pop() || '';
    const newCalls = lines.reduce((sum, l) => sum + (l.match(TOOL_USE_COUNT_RE)?.length || 0), 0);
    if (newCalls > 0) {
      toolCalls += newCalls;
      const now = Date.now();
      if (now - lastReportedAt >= REPRO_PROGRESS_THROTTLE_MS) {
        lastReportedAt = now;
        setPhase(reqId, `🔬 Reproducing the bug… (${toolCalls} actions so far)`);
      }
    }
    for (const line of lines) {
      const hit = editedFilePathsInLine(line).some(
        (filePath) => filePath.startsWith('src/') && !/\.(test|spec)\./.test(filePath),
      );
      if (!hit) continue;
      if (ctrl.stop) return; // the run moved on — never regress a later phase
      setPhase(reqId, '🛠 Implementing the fix…');
      log(`🛠 #${n} first source edit seen — phase → fixing`);
      return;
    }
  }
}

// Claude runs model-authored commands with permissions skipped, on content that
// includes untrusted issue text — keep Tasker's secrets out of its environment.
function claudeEnv() {
  const env = { ...process.env };
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_USER_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GITHUB_TOKEN']) {
    delete env[k];
  }
  return env;
}

// A run has several phases AFTER claude's session ends (red/green jest, browser
// replay, stashing, proposal update) — that tail can take minutes, so a widget
// showing a flat "Analyzing…" looks stuck once the session itself is visibly
// done. Publish the current phase so the UI can name it. Fire-and-forget and
// state-filtered: a phase write must never fail a run or resurrect a canceled row.
function setPhase(reqId, phase) {
  void updateRequest(reqId, { progress: phase }, { requireState: 'running' }).catch(() => {});
}

// ── request lifecycle ────────────────────────────────────────────────────────
async function updateProposalRow(id, values) {
  const q = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${SUPABASE_USER_ID}` });
  return supabaseRequest(`proposals?${q}`, { method: 'PATCH', body: values, prefer: 'return=representation' });
}

async function updateRequest(id, values, { requireState } = {}) {
  const q = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${SUPABASE_USER_ID}` });
  if (requireState) q.set('state', `eq.${requireState}`);
  const rows = await supabaseRequest(`analysis_requests?${q}`, {
    method: 'PATCH',
    body: values,
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function parseOutput(text) {
  const summaryMatch = text.match(/===\s*SUMMARY\s*===\s*([\s\S]*?)(?====\s*PROPOSAL\s*===|$)/i);
  const proposalMatch = text.match(/===\s*PROPOSAL\s*===\s*([\s\S]*)$/i);
  const summary = (summaryMatch?.[1] || '').trim().slice(0, 1500);
  let proposal = (proposalMatch?.[1] || '').trim();
  const notReproduced = /^NOT_REPRODUCED\b/i.test(proposal);
  if (notReproduced || /^UNCHANGED\b/i.test(proposal)) proposal = '';
  return { summary: summary || text.trim().slice(-1200), proposal, notReproduced };
}

function changedFiles(porcelain) {
  return porcelain
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .map((f) => (f.includes(' -> ') ? f.split(' -> ').pop() : f))
    .map((f) => f.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function isTestFile(f) {
  return /(^|\/)tests?\//.test(f) || /\.(test|spec)\.[jt]sx?$/i.test(f) || /Test\.[jt]sx?$/.test(f);
}

// Red/green verification: with the fix still in the working tree, run the
// changed test files (expect PASS), then revert only the source files via a
// saved patch and run again (expect FAIL — proving the test captures the bug),
// then re-apply the fix. Returns a one-line verdict for the summary/Telegram.
async function redGreenCheck(n, files, overlap) {
  const testFiles = files.filter(isTestFile);
  // .repros/ recordings are run artifacts, not source — without this exclusion
  // an authored replay would trip the "fix adds new files" skip below.
  const srcFiles = files.filter((f) => !isTestFile(f) && !f.startsWith('.repros/'));
  if (!testFiles.length) return srcFiles.length ? '⚠️ no repro test in the change set — fix unverified' : null;
  if (!srcFiles.length) return 'test-only change — nothing to red/green';

  log(`🧪 #${n} red/green: ${testFiles.length} test file(s) vs ${srcFiles.length} src file(s)`);
  const green = await run('npx', ['jest', ...testFiles, '--silent'], { cwd: APP_REPO_DIR, timeoutMs: JEST_TIMEOUT_MS });
  if (green.timedOut) return '⏱️ repro test run timed out — fix unverified';
  if (green.code !== 0) return '🚨 tests FAIL even with the fix applied — needs a human look';

  // The red half needs a clean revert of exactly the fix. Skip it when that
  // isn't possible: brand-new source files (checkout -- can't revert them) or
  // files that also carry the user's own pre-existing edits.
  if (overlap.length) return '🟢 repro tests pass with the fix (red-check skipped: pre-existing local edits overlap)';
  for (const f of srcFiles) {
    const tracked = await git(['ls-files', '--error-unmatch', f]);
    if (tracked.code !== 0) return '🟢 repro tests pass with the fix (red-check skipped: fix adds new files)';
  }

  const diff = await git(['diff', '--', ...srcFiles]);
  if (diff.code !== 0 || !diff.stdout.trim()) return '🟢 repro tests pass with the fix (red-check skipped: could not capture the fix diff)';
  const patchFile = path.join(tmpdir(), `tasker-fix-${n}-${Date.now()}.patch`);
  await writeFile(patchFile, diff.stdout);
  await git(['checkout', '--', ...srcFiles]);
  const red = await run('npx', ['jest', ...testFiles, '--silent'], { cwd: APP_REPO_DIR, timeoutMs: JEST_TIMEOUT_MS });
  const reapply = await git(['apply', patchFile]);
  if (reapply.code !== 0) {
    // Never lose the fix silently — the patch file has it.
    const msg = `🚨 red-check could not re-apply the fix — recover it from ${patchFile}`;
    log(msg);
    return msg;
  }
  if (red.timedOut) return '🟢 repro tests pass with the fix (red run timed out)';
  if (red.code !== 0) return '✅ VERIFIED red/green — repro test FAILS without the fix, PASSES with it';
  return '⚠️ repro tests pass even WITHOUT the fix — the test may not capture the bug';
}

// Browser-level red/green via fast-replay: when the run authored a recording
// in .repros/issue-<n>, replay it against the live dev app — `--expect-fixed`
// must pass with the fix in the tree (green), the plain run must pass (bug
// observed) with the src files reverted (red), then re-apply. Same honest-skip
// rules as the Jest check. Requires the dev server to be serving; each tree
// change waits REBUILD_WAIT_MS for the dev server to rebuild before replaying.
async function browserRedGreenCheck(n, files, overlap) {
  const reproName = `issue-${n}`;
  if (!existsSync(path.join(APP_REPO_DIR, '.repros', reproName))) return null;
  const srcFiles = files.filter((f) => !isTestFile(f) && !f.startsWith('.repros/'));
  if (!srcFiles.length) return null;

  const served = await run(
    'curl',
    ['-sk', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', 'https://dev.new.expensify.com:8082/'],
    { timeoutMs: 15_000 },
  );
  if (!/^2\d\d$/.test((served.stdout || '').trim())) {
    return '🌐 replay skipped: dev server not serving on :8082';
  }

  const replay = (extra = []) =>
    // --headed = real Chrome, so the replay clears Cloudflare's bot challenge
    // (headless Chromium 403s on every /api/* call).
    run('repro', ['run', reproName, '--profile', PW_PROFILE_DIR, '--headed', ...extra], {
      cwd: APP_REPO_DIR,
      timeoutMs: REPRO_TIMEOUT_MS,
    });

  const green = await replay(['--expect-fixed']);
  if (green.timedOut) return '🌐 replay timed out with the fix — browser verification inconclusive';
  if (green.code !== 0) return '🌐 replay still shows the bug WITH the fix — needs a human look';

  if (overlap.length) return '🌐 replay green with the fix (browser red-check skipped: pre-existing local edits overlap)';
  for (const f of srcFiles) {
    const tracked = await git(['ls-files', '--error-unmatch', f]);
    if (tracked.code !== 0) return '🌐 replay green with the fix (browser red-check skipped: fix adds new files)';
  }
  const diff = await git(['diff', '--', ...srcFiles]);
  if (diff.code !== 0 || !diff.stdout.trim()) {
    return '🌐 replay green with the fix (browser red-check skipped: could not capture the fix diff)';
  }
  const patchFile = path.join(tmpdir(), `tasker-fix-${n}-browser-${Date.now()}.patch`);
  await writeFile(patchFile, diff.stdout);
  await git(['checkout', '--', ...srcFiles]);
  await new Promise((r) => setTimeout(r, REBUILD_WAIT_MS));
  const red = await replay();
  const reapply = await git(['apply', patchFile]);
  if (reapply.code !== 0) {
    // Never lose the fix silently — the patch file has it.
    const msg = `🚨 browser red-check could not re-apply the fix — recover it from ${patchFile}`;
    log(msg);
    return msg;
  }
  if (red.timedOut) return '🌐 replay green with the fix (browser red run timed out)';
  if (red.code !== 0) return '⚠️ replay does not observe the bug even WITHOUT the fix — the recording may not capture it';
  return '🌐 VERIFIED browser red/green — replay observes the bug without the fix, gone with it';
}

// ── run videos ───────────────────────────────────────────────────────────────
// The prompt has Claude record its red/green verification runs (bug happening,
// bug gone) into ~/.tasker/videos/issue-<n>. GitHub has no API for comment
// attachments, so the takes go to Telegram and the user drags them into the
// proposal by hand. The folder is wiped when a run starts, so a stale take can
// never pass as the current one.
const VIDEO_ROOT = path.join(homedir(), '.tasker', 'videos');
const TG_UPLOAD_LIMIT = 49 * 1024 * 1024; // bot API rejects uploads at 50MB

let ffmpegOk = null;
async function haveFfmpeg() {
  if (ffmpegOk === null) ffmpegOk = (await run('ffmpeg', ['-version'], { timeoutMs: 10_000 })).code === 0;
  return ffmpegOk;
}

async function sendRunVideos(n) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const dir = path.join(VIDEO_ROOT, `issue-${n}`);
  let names = [];
  try {
    names = (await readdir(dir)).filter((f) => /\.(webm|mp4|mov)$/i.test(f)).sort();
  } catch {
    return; // no folder — the run recorded nothing
  }
  for (const name of names) {
    try {
      let file = path.join(dir, name);
      // Telegram streams mp4 inline; webm arrives as a bare file. Transcode
      // when ffmpeg is around so the ping is watchable in one tap, fall back
      // to sending the webm as a document when it isn't.
      let sendAs = /\.webm$/i.test(name) ? 'document' : 'video';
      if (sendAs === 'document' && (await haveFfmpeg())) {
        const mp4 = path.join(tmpdir(), `tasker-video-${n}-${name.replace(/\.webm$/i, '')}.mp4`);
        const t = await run(
          'ffmpeg',
          ['-y', '-i', file, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4],
          { timeoutMs: 60_000 },
        );
        if (t.code === 0) {
          file = mp4;
          sendAs = 'video';
        }
      }
      const st = await stat(file);
      if (st.size > TG_UPLOAD_LIMIT) {
        log(`🎬 #${n} ${name} is ${(st.size / 1e6).toFixed(0)}MB — over Telegram's bot upload limit, left in ${dir}`);
        continue;
      }
      const form = new FormData();
      form.append('chat_id', TG_CHAT);
      form.append('caption', `🎬 ${REPO}#${n} — ${name}`);
      form.append(
        sendAs,
        new Blob([await readFile(file)], { type: sendAs === 'video' ? 'video/mp4' : 'video/webm' }),
        path.basename(file),
      );
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/send${sendAs === 'video' ? 'Video' : 'Document'}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) log(`🎬 #${n} sent ${name} to Telegram`);
      else log(`🎬 #${n} ${name} upload failed (${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}) — left in ${dir}`);
    } catch (e) {
      log(`🎬 #${n} ${name} send errored: ${e instanceof Error ? e.message : String(e)} — left in ${dir}`);
    }
  }
}

async function processRequest(req) {
  const n = req.issue_number;
  const claimed = await updateRequest(req.id, { state: 'running' }, { requireState: 'queued' });
  if (!claimed) return;
  log(`🔬 #${n} analysis starting`);
  await rm(path.join(VIDEO_ROOT, `issue-${n}`), { recursive: true, force: true }).catch(() => {});
  setPhase(req.id, 'Preparing the checkout…');

  const fail = async (error) => {
    log(`❌ #${n} analysis failed: ${error}`);
    // #99086: this write can itself fail (a transient network blip hit both
    // the original error AND this one, back to back). Unguarded, that second
    // throw propagated out of fail() and past processRequest entirely, so the
    // row stayed 'running' forever instead of landing on 'failed' — the exact
    // state recoverOrphanedRuns() already knows how to re-queue at boot, had
    // it ever gotten there. Never let reporting a failure produce a worse one.
    try {
      // State-filtered: a cancel that landed meanwhile must not be overwritten.
      const row = await updateRequest(req.id, { state: 'failed', last_error: String(error).slice(0, 500), progress: null }, { requireState: 'running' });
      if (row) await notify(`⚠️ Claude analysis for ${REPO}#${n} failed: ${String(error).slice(0, 200)}`);
    } catch (e) {
      log(`#${n} could not even record the failure: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  try {
    // Preflight: snapshot pre-existing dirty files. The run may proceed on a
    // dirty checkout — afterwards we stash ONLY files that were clean before
    // and changed during the run. Files that were already dirty stay untouched
    // (and if Claude edits one of those, it's flagged, not stashed — the two
    // sets of edits can't be separated cleanly).
    const status = await git(['status', '--porcelain']);
    if (status.code !== 0) return void (await fail(`git status failed: ${status.stderr.slice(0, 200)}`));
    const preDirty = new Set(changedFiles(status.stdout));
    if (preDirty.size) log(`⚠️ #${n} checkout has ${preDirty.size} pre-existing dirty file(s) — they will be left alone`);

    const { status: ghStatus, data: issue } = await gh(`/repos/${REPO}/issues/${n}`);
    if (ghStatus !== 200 || !issue) return void (await fail(`could not fetch issue (${ghStatus})`));

    const propQ = new URLSearchParams({
      select: 'id,body,state,github_comment_id',
      user_id: `eq.${SUPABASE_USER_ID}`,
      repo_owner: `ilike.${REPO_OWNER}`,
      repo_name: `ilike.${REPO_NAME}`,
      issue_number: `eq.${n}`,
      limit: '1',
    });
    const propRows = await supabaseRequest(`proposals?${propQ}`);
    const proposal = Array.isArray(propRows) ? propRows[0] || null : null;

    const template = await readFile(PROMPT_FILE, 'utf8');
    // Magic codes are dynamic (emailed per login), so existing accounts can't be
    // used headlessly. Instead: a BRAND-NEW +suffix address shows the "Join"
    // button — a fresh account with no code required. Generate a new suffix per
    // run; fresh accounts also make data seeding deterministic.
    const [mailboxUser, mailboxDomain] = TEST_ACCOUNT_EMAIL.split('@');
    const testAccount =
      mailboxUser && mailboxDomain
        ? `sign UP (never sign in) with a BRAND-NEW address each run: ` +
          `${mailboxUser}+${n}x${Date.now().toString(36)}@${mailboxDomain} (or add your own fresh suffix). ` +
          `A never-used address shows the "Join" button — click it and you are in a new account with NO magic code. ` +
          `If you ever see a magic-code prompt, the address was used before: switch to a new suffix. ` +
          `Need a second user? Use another fresh +suffix on the same mailbox.`
        : '(no TEST_ACCOUNT_EMAIL mailbox configured — auth-gated flows cannot be reproduced live; state this when falling back)';
    // The C+ picks between us and MelvinBot, so the deep analysis needs to see
    // what it is competing with, not just our own draft.
    const analysisComments = await gh(`/repos/${REPO}/issues/${n}/comments?per_page=100`);
    const melvin = findMelvinProposal(
      Array.isArray(analysisComments.data) ? analysisComments.data : [],
    );

    const prompt = template
      .replaceAll('<<<ISSUE_NUMBER>>>', String(n))
      .replace('<<<TEST_ACCOUNT>>>', testAccount)
      .replace('<<<ISSUE>>>', `#${n}: ${issue.title}\n\n${issue.body || '(no description)'}`)
      .replace('<<<PROPOSAL>>>', proposal?.body || '(no proposal drafted yet)')
      .replace('<<<MELVIN>>>', melvin || '(MelvinBot has not posted a proposal)');

    // json output = the same final text plus metadata — notably session_id,
    // which the widget offers as a copyable `claude --resume` command.
    const args = ['-p', '--dangerously-skip-permissions', '--output-format', 'json', '--name', String(n)];
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
    // fast-replay's MCP server: gives the run a one-call `repro_run` tool
    // (verdict + failing step + console + network + screenshot) instead of
    // shelling out to the CLI. Additive to the App repo's own MCP config.
    if (existsSync(REPRO_MCP_CONFIG)) args.push('--mcp-config', REPRO_MCP_CONFIG);
    log(`🤖 #${n} running claude (timeout ${Math.round(CLAUDE_TIMEOUT_MS / 60000)}m)`);
    setPhase(req.id, '🔬 Reproducing the bug…');
    const phaseWatch = { stop: false };
    // sessionInfo.transcript is read again at stash-time, once claude has
    // exited and the file is complete, for the authoritative touched-files
    // scan — this fire-and-forget chain runs the live progress/phase watch in
    // the meantime and just leaves the path behind for that later read.
    const sessionInfo = { transcript: null };
    void captureSessionEarly(req.id, n)
      .then((transcript) => {
        sessionInfo.transcript = transcript;
        return transcript ? watchFixPhase(req.id, n, transcript, phaseWatch) : null;
      })
      .catch(() => {});

    // Watch for the row changing state under us and kill the in-flight claude
    // when it does. Not just 'canceled': a Cancel followed by a fast Re-run can
    // outrun this poll and land as 'queued' — the old claude then kept running
    // and blocked the re-run until the 60m timeout (seen live on #90789 and
    // #96580). Any state other than 'running' (or a vanished row) means this
    // run's claim is gone.
    let canceled = false;
    let claudeChild = null;
    const cancelWatch = setInterval(() => {
      void (async () => {
        try {
          const q = new URLSearchParams({ id: `eq.${req.id}`, user_id: `eq.${SUPABASE_USER_ID}`, select: 'state', limit: '1' });
          const rows = await supabaseRequest(`analysis_requests?${q}`);
          if (!Array.isArray(rows)) return; // transient shape — retry next tick
          const state = rows[0]?.state ?? '(deleted)';
          if (state !== 'running') {
            canceled = true;
            clearInterval(cancelWatch);
            log(`🚫 #${n} run claim lost (row is '${state}') — killing claude`);
            killTree(claudeChild); // reap claude + its MCP children, not just claude
          }
        } catch {
          /* transient; retry next tick */
        }
      })();
    }, 15_000);

    let res;
    try {
      res = await run(CLAUDE_BIN, args, {
        cwd: APP_REPO_DIR,
        env: claudeEnv(),
        timeoutMs: CLAUDE_TIMEOUT_MS,
        input: prompt,
        resolveOnJson: true, // don't wait on lingering MCP servers once the result lands
        onChild: (c) => {
          claudeChild = c;
        },
      });
    } finally {
      clearInterval(cancelWatch);
      phaseWatch.stop = true; // later phases own the row from here
    }
    if (res.lingered) log(`⏭️  #${n} result received — reaped lingering claude/MCP instead of waiting for exit`);
    if (canceled) {
      // Park whatever partial work exists so the checkout is clean again. The
      // row was moved out of 'running' externally (canceled, or already
      // re-queued by a fast Re-run) — leave it exactly as the extension set it;
      // a 'queued' row gets picked up fresh by the main loop right after this.
      const part = await git(['status', '--porcelain']);
      const partTouched = sessionInfo.transcript ? await claudeTouchedFiles(sessionInfo.transcript) : null;
      const partIsClaudes = partTouched ? (f) => partTouched.has(f) : (f) => !preDirty.has(f);
      const partFiles = changedFiles(part.stdout).filter((f) => !preDirty.has(f) && partIsClaudes(f));
      if (partFiles.length) {
        await git(['stash', 'push', '-u', '-m', `canceled-analysis-#${n}`, '--', ...partFiles]);
        log(`🚫 #${n} canceled — ${partFiles.length} partial file(s) stashed as canceled-analysis-#${n}`);
      } else {
        log(`🚫 #${n} canceled — no partial changes`);
      }
      return;
    }
    if (res.timedOut) return void (await fail(`claude timed out after ${CLAUDE_TIMEOUT_MS}ms`));
    if (res.code !== 0) return void (await fail(`claude exited ${res.code}: ${res.stderr.slice(0, 300)}`));

    // --output-format json → {"result": "<final text>", "session_id": "...", ...}.
    // Fall back to treating stdout as plain text if parsing fails.
    let finalText = res.stdout.trim();
    let claudeSessionId = null;
    try {
      const j = JSON.parse(finalText);
      if (typeof j.result === 'string') finalText = j.result;
      claudeSessionId = j.session_id || null;
    } catch {
      /* plain-text fallback */
    }
    const { summary, proposal: updatedProposal, notReproduced } = parseOutput(finalText);

    // Stash exactly what CLAUDE changed — ground truth from its own tool
    // calls, not a before/after dirty-file diff. The diff alone can't tell
    // Claude's edit from someone else's landing in the same 10-40 minute
    // window: this checkout is the user's own active dev environment (real
    // branches, real commits), not a scratch clone, so a concurrent edit is a
    // real possibility, not a hypothetical — #99086's stash swept in unrelated
    // WIP from exactly that gap. Falls back to the old preDirty-only diff only
    // if the transcript was never captured at all, so a scan failure can't
    // silently drop Claude's own fix.
    const after = await git(['status', '--porcelain']);
    const afterFiles = changedFiles(after.stdout);
    const touched = sessionInfo.transcript ? await claudeTouchedFiles(sessionInfo.transcript) : null;
    const isClaudes = touched ? (f) => touched.has(f) : (f) => !preDirty.has(f);
    const files = afterFiles.filter((f) => !preDirty.has(f) && isClaudes(f));
    const overlap = afterFiles.filter((f) => !(!preDirty.has(f) && isClaudes(f)));
    const strayFiles = touched ? overlap.filter((f) => !preDirty.has(f)) : [];
    if (strayFiles.length) {
      log(`⚠️ #${n} left ${strayFiles.length} concurrently-modified file(s) alone (not ours): ${strayFiles.slice(0, 5).join(', ')}`);
    }

    // Reproduction gate: claude reported it could not reproduce the bug, so by
    // contract it implemented no fix and rewrote nothing. Stop here — park any
    // exploratory edits for hygiene and leave the proposal exactly as it was.
    if (notReproduced) {
      let stashRef = null;
      if (files.length) {
        const stash = await git(['stash', 'push', '-u', '-m', `not-reproduced-#${n}`, '--', ...files]);
        if (stash.code === 0) stashRef = `not-reproduced-#${n}`;
      }
      const row = await updateRequest(
        req.id,
        {
          state: 'failed',
          result_summary: summary.slice(0, 2000),
          stash_ref: stashRef,
          claude_session_id: claudeSessionId,
          last_error: 'Stopped: could not reproduce the bug — nothing was changed.',
          progress: null,
        },
        { requireState: 'running' },
      );
      log(`🚫 #${n} could not reproduce — stopped${stashRef ? ` (exploratory edits stashed as ${stashRef})` : ''}`);
      if (row) {
        await notify(
          `🚫 Deep analysis stopped — could not reproduce ${REPO}#${n}\n` +
            `https://github.com/${REPO}/issues/${n}\n\n${summary.slice(0, 500)}\n\nProposal left untouched.`,
        );
      }
      return;
    }

    // Red/green verification runs BEFORE stashing, while the fix is in the tree.
    let verification = null;
    setPhase(req.id, '🧪 Verifying the fix (red/green tests)…');
    try {
      verification = await redGreenCheck(n, files, overlap);
      if (verification) log(`🧪 #${n} ${verification}`);
    } catch (e) {
      verification = `red/green check errored: ${e instanceof Error ? e.message : String(e)}`;
      log(`🧪 #${n} ${verification}`);
    }
    // Browser-level verdict rides alongside the Jest one — either can skip
    // independently; a combined line reads "✅ ...; 🌐 ...".
    let browserVerification = null;
    setPhase(req.id, '🌐 Verifying in the browser (replay)…');
    try {
      browserVerification = await browserRedGreenCheck(n, files, overlap);
      if (browserVerification) log(`🌐 #${n} ${browserVerification}`);
    } catch (e) {
      browserVerification = `browser red/green errored: ${e instanceof Error ? e.message : String(e)}`;
      log(`🌐 #${n} ${browserVerification}`);
    }
    if (browserVerification) verification = verification ? `${verification}; ${browserVerification}` : browserVerification;

    let stashRef = null;
    if (files.length) {
      setPhase(req.id, '📦 Stashing the local fix…');
      const stash = await git(['stash', 'push', '-u', '-m', `tasker-analysis-#${n}`, '--', ...files]);
      if (stash.code === 0) {
        stashRef = `tasker-analysis-#${n}`;
        log(`📦 #${n} stashed ${files.length} file(s)${overlap.length ? ` (${overlap.length} pre-dirty file(s) left in place)` : ''}`);
      } else {
        log(`stash failed (leaving changes in place): ${stash.stderr.slice(0, 200)}`);
      }
    }

    // Push the updated proposal to where it lives: the posted GitHub comment,
    // the Supabase draft/armed body (state-filtered; never mid-post), or — when
    // the row is still mid-auto-pipeline (queued/drafting, i.e. Codex hasn't
    // armed a draft yet) — arm/post Claude's own reproduced-and-VERIFIED
    // proposal directly, since it supersedes an unfinished Codex draft. That
    // write is itself state-filtered: Codex's ~4 min draft commonly finishes
    // long before Claude's ~20-40 min deep analysis does, so if Codex already
    // armed or posted by the time we get here, we defer to it instead of
    // clobbering a live posted comment's row.
    let proposalNote = 'proposal unchanged';
    if (updatedProposal) setPhase(req.id, '📝 Updating the proposal…');
    const hasHW = (issue.labels || [])
      .map((l) => (typeof l === 'string' ? l : l?.name || '').toLowerCase())
      .includes('help wanted');
    const codexStillPending = proposal?.state === 'queued' || proposal?.state === 'drafting';

    if (updatedProposal && proposal && !codexStillPending) {
      if (proposal.github_comment_id && GITHUB_TOKEN) {
        const upd = await gh(`/repos/${REPO}/issues/comments/${proposal.github_comment_id}`, {
          method: 'PATCH',
          body: { body: updatedProposal },
        });
        proposalNote = upd.status === 200 ? 'updated the posted comment' : `comment update failed (${upd.status})`;
      } else {
        const q = new URLSearchParams({
          id: `eq.${proposal.id}`,
          user_id: `eq.${SUPABASE_USER_ID}`,
          state: 'in.(draft,armed)',
        });
        const rows = await supabaseRequest(`proposals?${q}`, {
          method: 'PATCH',
          body: { body: updatedProposal },
          prefer: 'return=representation',
        });
        proposalNote = Array.isArray(rows) && rows.length ? `updated the ${proposal.state} proposal body` : 'proposal row changed state — not updated';
      }
      // An armed proposal on an issue that ALREADY has Help Wanted will never
      // be fired by the sniper (it ignores stale label events) — post it here,
      // like the no-proposal path does. ("Post now" was retired from the UI.)
      if (hasHW && GITHUB_TOKEN && proposal.state === 'armed' && !proposal.github_comment_id) {
        const bodyToPost = updatedProposal || proposal.body;
        const claim = await supabaseRequest(
          `proposals?${new URLSearchParams({ id: `eq.${proposal.id}`, user_id: `eq.${SUPABASE_USER_ID}`, state: 'eq.armed' })}`,
          { method: 'PATCH', body: { state: 'posting' }, prefer: 'return=representation' },
        );
        if (Array.isArray(claim) && claim.length) {
          const post = await gh(`/repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: { body: bodyToPost } });
          if (post.status === 201 && post.data?.id) {
            await updateProposalRow(proposal.id, { state: 'posted', github_comment_id: post.data.id, posted_at: new Date().toISOString(), last_error: null });
            proposalNote += '; posted the armed proposal (Help Wanted already present)';
          } else {
            await updateProposalRow(proposal.id, { state: 'armed', last_error: `analyzer post failed: ${post.status}` });
            proposalNote += `; armed-post failed (${post.status})`;
          }
        }
      }
    } else if (updatedProposal && proposal && codexStillPending) {
      // Codex hasn't produced an armable draft yet — Claude's own verified
      // proposal supersedes whatever it was mid-writing. State-filtered to
      // queued/drafting so a Codex draft that finished in the meantime wins.
      if (hasHW && GITHUB_TOKEN) {
        const claimed = await supabaseRequest(
          `proposals?${new URLSearchParams({ id: `eq.${proposal.id}`, user_id: `eq.${SUPABASE_USER_ID}`, state: 'in.(queued,drafting)' })}`,
          { method: 'PATCH', body: { state: 'posting' }, prefer: 'return=representation' },
        );
        if (Array.isArray(claimed) && claimed.length) {
          const post = await gh(`/repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: { body: updatedProposal } });
          if (post.status === 201 && post.data?.id) {
            await updateProposalRow(proposal.id, {
              state: 'posted',
              body: updatedProposal,
              github_comment_id: post.data.id,
              posted_at: new Date().toISOString(),
              last_error: null,
            });
            proposalNote = "posted Claude's proposal (Help Wanted already present; Codex draft superseded)";
          } else {
            await updateProposalRow(proposal.id, { state: 'armed', body: updatedProposal, last_error: `analyzer post failed: ${post.status}` });
            proposalNote = `Claude's proposal claimed but post failed (${post.status}) — left armed`;
          }
        } else {
          proposalNote = "Codex armed/posted its draft first — Claude's proposal was not applied";
        }
      } else {
        const armed = await supabaseRequest(
          `proposals?${new URLSearchParams({ id: `eq.${proposal.id}`, user_id: `eq.${SUPABASE_USER_ID}`, state: 'in.(queued,drafting)' })}`,
          { method: 'PATCH', body: { state: 'armed', body: updatedProposal, last_error: null }, prefer: 'return=representation' },
        );
        proposalNote =
          Array.isArray(armed) && armed.length
            ? "armed Claude's proposal — the sniper posts it when Help Wanted lands (Codex draft superseded)"
            : "Codex armed/posted its draft first — Claude's proposal was not applied";
      }
    } else if (updatedProposal) {
      // No proposal exists yet — the analysis IS the proposal. Post it right
      // away when Help Wanted is already on the issue; otherwise save it as an
      // ARMED row so the sniper fires it at the second boundary the moment
      // Help Wanted lands (posting pre-HW would violate the posting rule).
      const upsert = (fields) =>
        supabaseRequest('proposals?on_conflict=user_id,repo_owner,repo_name,issue_number', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: {
            user_id: SUPABASE_USER_ID,
            repo_owner: REPO_OWNER,
            repo_name: REPO_NAME,
            issue_number: n,
            body: updatedProposal,
            origin: 'manual',
            ...fields,
          },
        });
      if (hasHW && GITHUB_TOKEN) {
        const post = await gh(`/repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: { body: updatedProposal } });
        if (post.status === 201 && post.data?.id) {
          await upsert({ state: 'posted', github_comment_id: post.data.id, posted_at: new Date().toISOString() });
          proposalNote = 'posted a NEW proposal comment';
        } else {
          await upsert({ state: 'armed' });
          proposalNote = `new-proposal post failed (${post.status}) — saved as armed instead`;
        }
      } else {
        await upsert({ state: 'armed' });
        proposalNote = hasHW
          ? 'armed a NEW proposal (no GITHUB_TOKEN to post it)'
          : 'armed a NEW proposal — the sniper posts it when Help Wanted lands';
      }
    }

    const overlapNote = overlap.length
      ? `; ⚠️ ${overlap.length} file(s) left unstashed (${strayFiles.length ? 'not ours — modified elsewhere during the run' : 'pre-existing local edits'}): ${overlap.slice(0, 3).join(', ')}`
      : '';
    const verificationNote = verification ? `${verification}; ` : '';
    const resultSummary = `${summary}\n\n[${verificationNote}${proposalNote}${stashRef ? `; stash: ${stashRef}` : '; no code changes'}${overlapNote}]`.slice(0, 2000);
    const doneRow = await updateRequest(
      req.id,
      { state: 'done', result_summary: resultSummary, stash_ref: stashRef, claude_session_id: claudeSessionId, last_error: null, progress: null },
      { requireState: 'running' },
    );
    if (!doneRow) {
      log(`#${n} finished but the request was canceled meanwhile — result kept in stash only`);
      return;
    }
    log(`✅ #${n} analysis done — ${proposalNote}${stashRef ? `, ${stashRef}` : ''}`);
    await notify(
      `🧠 Claude analysis done — ${REPO}#${n}\nhttps://github.com/${REPO}/issues/${n}\n\n${summary.slice(0, 600)}\n\n${verification ? `${verification}\n` : ''}${proposalNote}${stashRef ? `\nFix stashed: git stash list | grep "${stashRef}"` : '\n(no code changes)'}${overlapNote}`,
    );
    await sendRunVideos(n);
  } catch (e) {
    await fail(e instanceof Error ? e.message : String(e));
  }
}

// Only one analyzer runs at a time, so any `running` row at boot is an orphan
// from a previous process that died mid-analysis — requeue it.
async function recoverOrphanedRuns() {
  const q = new URLSearchParams({
    user_id: `eq.${SUPABASE_USER_ID}`,
    state: 'eq.running',
  });
  const rows = await supabaseRequest(`analysis_requests?${q}`, {
    method: 'PATCH',
    body: { state: 'queued', last_error: 'Recovered after an analyzer restart.' },
    prefer: 'return=representation',
  });
  if (Array.isArray(rows) && rows.length) {
    log(`♻️  re-queued ${rows.length} orphaned run(s): ${rows.map((r) => `#${r.issue_number}`).join(', ')}`);
  }
}

// ── Melvin-review gate ────────────────────────────────────────────────────────
// Melvin's login is "MelvinBot" (proposal author) or "melvin-bot[bot]"; match
// either, and only comments that read like a proposal/analysis.
function findMelvinProposal(comments) {
  const isMelvin = (login) => /^melvin/i.test(login || '');
  const looksLikeProposal = (body) =>
    /##\s*(Proposal|Issue Analysis)\b|What is the root cause/i.test(body || '');
  const hits = (comments || []).filter((c) => isMelvin(c.user?.login) && looksLikeProposal(c.body));
  return hits.length ? hits[hits.length - 1].body : null; // newest
}

function parseReview(text) {
  const v = text.match(/===\s*VERDICT\s*===\s*([\s\S]*?)(?====\s*REASON\s*===|$)/i);
  const r = text.match(/===\s*REASON\s*===\s*([\s\S]*)$/i);
  // Default DISTINCT (fail-open: keep armed) unless the model clearly says DUPLICATE.
  const verdict = /DUPLICATE/i.test(v?.[1] || '') ? 'DUPLICATE' : 'DISTINCT';
  const reason = (r?.[1] || '').trim().replace(/\s+/g, ' ').slice(0, 200) || '(no reason given)';
  return { verdict, reason };
}

async function buildReviewPrompt(issue, n, ourBody, melvinBody) {
  const tmpl = await readFile(REVIEW_PROMPT_FILE, 'utf8');
  const issueBlock = issue ? `#${n}: ${issue.title}\n\n${issue.body || '(no description)'}` : `#${n}`;
  return tmpl
    .replace('<<<ISSUE>>>', issueBlock)
    .replace('<<<PROPOSAL>>>', ourBody || '(empty)')
    .replace('<<<MELVIN>>>', melvinBody || '(none)');
}

// Poll for one armed+auto+unreviewed proposal and atomically claim it by
// stamping reviewed_at. Returns the claimed row, or null (nothing to do / lost
// the claim race). Disables itself if the reviewed_at column isn't there yet.
async function claimNextReview() {
  if (reviewDisabled) return null;
  try {
    const q = new URLSearchParams({
      select: 'id,issue_number,body,created_at',
      user_id: `eq.${SUPABASE_USER_ID}`,
      repo_owner: `ilike.${REPO_OWNER}`,
      repo_name: `ilike.${REPO_NAME}`,
      state: 'eq.armed',
      origin: 'eq.auto',
      reviewed_at: 'is.null',
      created_at: `gte.${new Date(Date.now() - REVIEW_MAX_AGE_MS).toISOString()}`,
      order: 'created_at.desc',
      limit: '1',
    });
    const rows = await supabaseRequest(`proposals?${q}`);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const cand = rows[0];
    const cq = new URLSearchParams({
      id: `eq.${cand.id}`,
      user_id: `eq.${SUPABASE_USER_ID}`,
      reviewed_at: 'is.null', // atomic: only one claimer wins
    });
    const claimed = await supabaseRequest(`proposals?${cq}`, {
      method: 'PATCH',
      body: { reviewed_at: new Date().toISOString() },
      prefer: 'return=representation',
    });
    return Array.isArray(claimed) && claimed[0] ? { ...cand, ...claimed[0] } : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/reviewed_at/.test(msg) && /(column|does not exist|42703|PGRST)/i.test(msg)) {
      reviewDisabled = true;
      log('⚠️ Melvin-review disabled — proposals.reviewed_at missing (apply migration 016, then restart)');
      return null;
    }
    throw e;
  }
}

// Marker prefix on last_error identifying a proposal the review gate dropped as
// a MelvinBot duplicate. The extension keys its badge off this exact string.
const MELVIN_DUP_PREFIX = 'melvin-duplicate:';

async function markDuplicate(id, reason) {
  // Disarm rather than delete: deleting left the widget in its pristine "no
  // proposal yet" state, indistinguishable from the drafter never having run.
  // Keeping the row lets the widget explain itself and lets the user re-arm if
  // the verdict was wrong. State-guarded to `armed` so a proposal the sniper
  // already moved to posting/posted is never touched.
  const q = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${SUPABASE_USER_ID}`, state: 'eq.armed' });
  const rows = await supabaseRequest(`proposals?${q}`, {
    method: 'PATCH',
    body: { state: 'draft', last_error: `${MELVIN_DUP_PREFIX} ${reason}`.trim() },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function processReview(proposal) {
  const n = proposal.issue_number;
  const issueUrl = `https://github.com/${REPO}/issues/${n}`;
  log(`🔎 #${n} reviewing auto-draft vs MelvinBot`);
  const issueRes = await gh(`/repos/${REPO}/issues/${n}`);
  const issue = issueRes.status === 200 ? issueRes.data : null;
  const title = issue?.title ? ` — ${issue.title}` : '';
  if (issue && issue.state !== 'open') {
    log(`#${n} review skipped — issue not open (${issue.state}); leaving as-is`);
    return;
  }
  const commentsRes = await gh(`/repos/${REPO}/issues/${n}/comments?per_page=100`);
  const melvin = findMelvinProposal(Array.isArray(commentsRes.data) ? commentsRes.data : []);

  if (!melvin) {
    const ageMs = Date.now() - Date.parse(proposal.created_at || '');
    if (ageMs < REVIEW_MELVIN_GRACE_MS) {
      // Melvin may still post — un-claim and retry on a later tick.
      await updateProposalRow(proposal.id, { reviewed_at: null });
      log(`⏭️  #${n} review deferred — no MelvinBot proposal yet (within grace)`);
      return;
    }
    log(`🔬 #${n} kept armed — MelvinBot posted no proposal (we stand alone)`);
    await notify(
      `🔬 Proposal kept — ours is the only one\n` +
        `${REPO}#${n}${title}\n` +
        `${issueUrl}\n\n` +
        `MelvinBot posted no proposal, so ours stands alone. It's armed and will be posted when the issue opens to contributors.\n` +
        `Tap below to run a deep Claude analysis and verify it.`,
      { replyMarkup: runAnalysisButtons(n, issueUrl) },
    );
    return;
  }

  const prompt = await buildReviewPrompt(issue, n, proposal.body || '', melvin);
  const args = ['-p', '--output-format', 'json', '--name', String(n)]; // no tool use → no --dangerously-skip-permissions
  if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
  const res = await run(CLAUDE_BIN, args, {
    cwd: APP_REPO_DIR,
    env: claudeEnv(),
    timeoutMs: REVIEW_TIMEOUT_MS,
    input: prompt,
  });
  if (res.timedOut || res.code !== 0) {
    log(`#${n} review inconclusive (${res.timedOut ? 'timeout' : `exit ${res.code}`}) — leaving armed`);
    return; // fail-open
  }
  let finalText = res.stdout.trim();
  try {
    const j = JSON.parse(finalText);
    if (typeof j.result === 'string') finalText = j.result;
  } catch {
    /* plain-text fallback */
  }
  const { verdict, reason } = parseReview(finalText);

  if (verdict === 'DUPLICATE') {
    if (await markDuplicate(proposal.id, reason)) {
      log(`🗑️  #${n} disarmed — duplicate of MelvinBot: ${reason}`);
      await notify(
        `🗑️ Proposal cleared — same as MelvinBot's\n` +
          `${REPO}#${n}${title}\n` +
          `${issueUrl}\n\n` +
          `Why: ${reason}\n` +
          `Disarmed, so it won't be posted — no point competing with an identical proposal. ` +
          `The draft is still on the issue in Tasker if you disagree.`,
      );
    } else {
      log(`#${n} dup verdict but no longer armed (posted/changed) — left as-is`);
    }
  } else {
    log(`🔬 #${n} distinct from MelvinBot — kept armed: ${reason}`);
    await notify(
      `🔬 Proposal kept — beats MelvinBot's\n` +
        `${REPO}#${n}${title}\n` +
        `${issueUrl}\n\n` +
        `Why: ${reason}\n` +
        `It's armed and will be posted when the issue opens to contributors.\n` +
        `Tap below to run a deep Claude analysis and verify it.`,
      { replyMarkup: runAnalysisButtons(n, issueUrl) },
    );
  }
}

// ── main loop ────────────────────────────────────────────────────────────────
async function tick() {
  if (busy) return;
  const q = new URLSearchParams({
    select: '*',
    user_id: `eq.${SUPABASE_USER_ID}`,
    repo_owner: `ilike.${REPO_OWNER}`,
    repo_name: `ilike.${REPO_NAME}`,
    state: 'eq.queued',
    order: 'created_at.asc',
    limit: '1',
  });
  const rows = await supabaseRequest(`analysis_requests?${q}`);
  if (Array.isArray(rows) && rows.length > 0) {
    busy = true;
    try {
      await processRequest(rows[0]);
    } finally {
      busy = false;
    }
    return;
  }
  // No heavy analysis queued — spend the idle tick on one Melvin-review.
  if (!REVIEW_ENABLED) return;
  const proposal = await claimNextReview();
  if (!proposal) return;
  busy = true;
  try {
    await processReview(proposal);
  } finally {
    busy = false;
  }
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  setTimeout(() => void loop(), POLL_INTERVAL_MS);
}

// A fresh daemon means any of OUR prior claude runs and their MCP helpers are
// orphaned (e.g. after a `kickstart` restart, which SIGKILLs the daemon without
// reaping the tree). Reap them at boot so they never accumulate. Targeted and
// safe: only our analysis runs (claude -p with our --mcp-config) and MCP/
// playwright helpers with NO live parent (ppid=1) — never the user's own
// interactive `claude` sessions or their live MCP children.
async function reapOrphanProcesses() {
  // ONLY our own analysis runs. Each is spawned detached, so it leads its own
  // process group and its MCP servers inherit that group — killing the group
  // (-PID) reaps the whole tree precisely.
  //
  // Deliberately NO global "orphaned mcp/playwright" sweep: the user runs their
  // own interactive claude sessions (often several, for days) in this same
  // checkout, and a broad `pgrep -f 'mcp|playwright'` + ppid==1 rule can match
  // THEIR MCP servers during an npm-exec reparent — killing tools out from under
  // a live session and making it respawn them (CPU churn). Ours are identifiable
  // by the analyzer's own --mcp-config path; nothing else is safe to assume.
  const script =
    "for p in $(pgrep -f 'claude -p .*analyzer/repro-mcp' 2>/dev/null); do " +
    '  kill -9 -"$p" 2>/dev/null || kill -9 "$p" 2>/dev/null; ' +
    'done; true';
  await run('bash', ['-c', script], { timeoutMs: 20_000 });
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_USER_ID) {
    console.error('analyzer requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_USER_ID (see .env.example)');
    process.exit(1);
  }
  const probe = await git(['rev-parse', '--is-inside-work-tree']);
  if (probe.code !== 0) {
    console.error(`APP_REPO_DIR (${APP_REPO_DIR}) is not a git checkout`);
    process.exit(1);
  }
  log(
    `analyzer up — repo=${REPO} checkout=${APP_REPO_DIR} claude=${CLAUDE_BIN}${CLAUDE_MODEL ? ` model=${CLAUDE_MODEL}` : ''} ` +
      `poll=${POLL_INTERVAL_MS}ms review=${REVIEW_ENABLED ? 'on' : 'off'} telegram=${TG_TOKEN && TG_CHAT ? 'on' : 'off'} github=${GITHUB_TOKEN ? 'token' : 'anon'}`,
  );
  try {
    await recoverOrphanedRuns();
  } catch (e) {
    log(`orphan sweep failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await reapOrphanProcesses(); // kill leaked claude/MCP processes from a dead daemon
  } catch (e) {
    log(`process reap failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  void tgUpdatesLoop(); // listen for the "Run deep analysis" button
  void loop();
}

void main();
