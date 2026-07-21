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

import { readFile, writeFile } from 'node:fs/promises';
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

let busy = false;

// ── helpers ──────────────────────────────────────────────────────────────────
function int(k, d) {
  const v = process.env[k];
  return v ? parseInt(v, 10) : d;
}
function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function notify(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`telegram err: ${res.status}`);
  } catch (e) {
    log(`telegram err: ${e instanceof Error ? e.message : String(e)}`);
  }
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

function run(cmd, args, { cwd, env, timeoutMs, input, onChild } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env || process.env,
      stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    if (onChild) onChild(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {
            /* gone */
          }
        }, timeoutMs)
      : null;
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}`, timedOut });
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

function git(args, opts = {}) {
  return run('git', args, { cwd: APP_REPO_DIR, timeoutMs: 60_000, ...opts });
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
  if (/^UNCHANGED\b/i.test(proposal)) proposal = '';
  return { summary: summary || text.trim().slice(-1200), proposal };
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
    run('repro', ['run', reproName, '--profile', PW_PROFILE_DIR, ...extra], {
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

async function processRequest(req) {
  const n = req.issue_number;
  const claimed = await updateRequest(req.id, { state: 'running' }, { requireState: 'queued' });
  if (!claimed) return;
  log(`🔬 #${n} analysis starting`);

  const fail = async (error) => {
    log(`❌ #${n} analysis failed: ${error}`);
    // State-filtered: a cancel that landed meanwhile must not be overwritten.
    const row = await updateRequest(req.id, { state: 'failed', last_error: String(error).slice(0, 500) }, { requireState: 'running' });
    if (row) await notify(`⚠️ Claude analysis for ${REPO}#${n} failed: ${String(error).slice(0, 200)}`);
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
    const prompt = template
      .replaceAll('<<<ISSUE_NUMBER>>>', String(n))
      .replace('<<<TEST_ACCOUNT>>>', testAccount)
      .replace('<<<ISSUE>>>', `#${n}: ${issue.title}\n\n${issue.body || '(no description)'}`)
      .replace('<<<PROPOSAL>>>', proposal?.body || '(no proposal drafted yet)');

    // json output = the same final text plus metadata — notably session_id,
    // which the widget offers as a copyable `claude --resume` command.
    const args = ['-p', '--dangerously-skip-permissions', '--output-format', 'json'];
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
    // fast-replay's MCP server: gives the run a one-call `repro_run` tool
    // (verdict + failing step + console + network + screenshot) instead of
    // shelling out to the CLI. Additive to the App repo's own MCP config.
    if (existsSync(REPRO_MCP_CONFIG)) args.push('--mcp-config', REPRO_MCP_CONFIG);
    log(`🤖 #${n} running claude (timeout ${Math.round(CLAUDE_TIMEOUT_MS / 60000)}m)`);

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
            try {
              claudeChild?.kill('SIGKILL');
            } catch {
              /* already gone */
            }
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
        onChild: (c) => {
          claudeChild = c;
        },
      });
    } finally {
      clearInterval(cancelWatch);
    }
    if (canceled) {
      // Park whatever partial work exists so the checkout is clean again. The
      // row was moved out of 'running' externally (canceled, or already
      // re-queued by a fast Re-run) — leave it exactly as the extension set it;
      // a 'queued' row gets picked up fresh by the main loop right after this.
      const part = await git(['status', '--porcelain']);
      const partFiles = changedFiles(part.stdout).filter((f) => !preDirty.has(f));
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
    const { summary, proposal: updatedProposal } = parseOutput(finalText);

    // Stash exactly what the run changed: post-run dirty files minus the ones
    // that were already dirty before it started (those are the user's).
    const after = await git(['status', '--porcelain']);
    const afterFiles = changedFiles(after.stdout);
    const files = afterFiles.filter((f) => !preDirty.has(f));
    const overlap = afterFiles.filter((f) => preDirty.has(f));

    // Red/green verification runs BEFORE stashing, while the fix is in the tree.
    let verification = null;
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
      const stash = await git(['stash', 'push', '-u', '-m', `tasker-analysis-#${n}`, '--', ...files]);
      if (stash.code === 0) {
        stashRef = `tasker-analysis-#${n}`;
        log(`📦 #${n} stashed ${files.length} file(s)${overlap.length ? ` (${overlap.length} pre-dirty file(s) left in place)` : ''}`);
      } else {
        log(`stash failed (leaving changes in place): ${stash.stderr.slice(0, 200)}`);
      }
    }

    // Push the updated proposal to where it lives: the posted GitHub comment,
    // else the Supabase draft/armed body (state-filtered; never mid-post).
    let proposalNote = 'proposal unchanged';
    if (updatedProposal && proposal) {
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
      const hwNow = (issue.labels || [])
        .map((l) => (typeof l === 'string' ? l : l?.name || '').toLowerCase())
        .includes('help wanted');
      if (hwNow && GITHUB_TOKEN && proposal.state === 'armed' && !proposal.github_comment_id) {
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
    } else if (updatedProposal) {
      // No proposal exists yet — the analysis IS the proposal. Post it right
      // away when Help Wanted is already on the issue; otherwise save it as an
      // ARMED row so the sniper fires it at the second boundary the moment
      // Help Wanted lands (posting pre-HW would violate the posting rule).
      const hasHW = (issue.labels || [])
        .map((l) => (typeof l === 'string' ? l : l?.name || '').toLowerCase())
        .includes('help wanted');
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

    const overlapNote = overlap.length ? `; ⚠️ ${overlap.length} file(s) had pre-existing local edits and were left unstashed: ${overlap.slice(0, 3).join(', ')}` : '';
    const verificationNote = verification ? `${verification}; ` : '';
    const resultSummary = `${summary}\n\n[${verificationNote}${proposalNote}${stashRef ? `; stash: ${stashRef}` : '; no code changes'}${overlapNote}]`.slice(0, 2000);
    const doneRow = await updateRequest(
      req.id,
      { state: 'done', result_summary: resultSummary, stash_ref: stashRef, claude_session_id: claudeSessionId, last_error: null },
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
  if (!Array.isArray(rows) || rows.length === 0) return;
  busy = true;
  try {
    await processRequest(rows[0]);
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
      `poll=${POLL_INTERVAL_MS}ms telegram=${TG_TOKEN && TG_CHAT ? 'on' : 'off'} github=${GITHUB_TOKEN ? 'token' : 'anon'}`,
  );
  try {
    await recoverOrphanedRuns();
  } catch (e) {
    log(`orphan sweep failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  void loop();
}

void main();
