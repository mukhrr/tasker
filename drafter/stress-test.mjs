#!/usr/bin/env node
/**
 * Integration test for the drafter, against mock Supabase + GitHub servers and
 * a fake `codex` binary on PATH. No network, no real Codex, no real GitHub.
 *
 * Covers: queued→drafting→armed, validator rejection → draft, already-Help-Wanted
 * direct post, enrichment editing a posted comment, stale-drafting recovery, and
 * that a manual (origin='manual') row is never drafted.
 */

import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DRAFTER = new URL('.', import.meta.url);

// A fake `codex` that copies a numbered canned proposal into the
// --output-last-message target. Picks $FAKE_CODEX_DIR/<n>.md by an incrementing
// counter (falls back to the highest that exists), so a scenario can hand out
// bad-then-good outputs. Touch $FAKE_CODEX_DIR/usage_limit to simulate the cap.
const FAKE_CODEX = `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_CODEX_DIR;
const argv = process.argv.slice(2);
const oi = argv.indexOf('--output-last-message');
const out = oi >= 0 ? argv[oi + 1] : null;
if (existsSync(path.join(dir, 'usage_limit'))) {
  console.log('You have hit your usage limit. Try again later.');
  process.exit(0);
}
let n = 0;
const cf = path.join(dir, 'count');
try { n = parseInt(readFileSync(cf, 'utf8'), 10) || 0; } catch {}
n += 1;
writeFileSync(cf, String(n));
let pick = n;
while (pick > 1 && !existsSync(path.join(dir, pick + '.md'))) pick -= 1;
const body = readFileSync(path.join(dir, pick + '.md'), 'utf8');
if (out) writeFileSync(out, body);
// Capture the prompt (last positional arg) so tests can assert its wiring.
writeFileSync(path.join(dir, 'last_prompt.txt'), argv[argv.length - 1] || '');
console.log('done');
`;

const GOOD_PROPOSAL = `## Proposal

### What is the root cause of that problem?

When the amount input is blurred while empty, the component falls back to \`undefined\` instead of \`0\`, so the downstream formatter throws. This happens because the guard only checks for null, not empty string.

### What changes do you think we should make in order to solve the problem?

I think we should normalize the empty input to \`0\` at the point where \`onBlur\` reads the value in \`MoneyRequestAmountInput\`. Coercing an empty string to \`0\` before it reaches the formatter keeps the existing validation intact and avoids the crash. This is a small, contained change with no effect on non-empty inputs.

### What alternative solutions did you explore? (Optional)

I considered guarding inside the formatter itself, but that would mask the same bug for other callers, so fixing it at the input boundary is cleaner.
`;

const MISSING_HEADING = `## Proposal

### What is the root cause of that problem?

The value is undefined when empty and the formatter throws. This is a reasonably long paragraph describing the cause so the length gate does not trip before the missing-heading gate is evaluated by the validator during this test scenario run.
`;

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let body = '';
  for await (const c of req) body += c;
  return body ? JSON.parse(body) : null;
}

async function runScenario({ name, env, seedRows, issue, cannedProposals, run }) {
  // Repo dir must be a git repo so ensureRepo skips cloning and refreshRepo's
  // fetch fails soft (no 'origin' remote in this throwaway repo).
  const repoDir = mkdtempSync(path.join(tmpdir(), 'drafter-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repoDir });

  const codexDir = mkdtempSync(path.join(tmpdir(), 'drafter-codex-'));
  cannedProposals.forEach((p, i) => writeFileSync(path.join(codexDir, `${i + 1}.md`), p));

  const state = {
    rows: new Map(seedRows.map((r) => [r.id, { ...r }])),
    autoPost: true,
    issue,
    commentPosts: [],
    commentPatches: [],
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/rest/v1/user_settings') {
      return json(res, 200, [{ proposal_auto_post: state.autoPost }]);
    }
    if (url.pathname === '/rest/v1/proposals' && req.method === 'GET') {
      const wantState = (url.searchParams.get('state') || '').replace('eq.', '');
      const wantOrigin = (url.searchParams.get('origin') || '').replace('eq.', '');
      const idFilter = (url.searchParams.get('id') || '').replace('eq.', '');
      let rows = [...state.rows.values()];
      if (idFilter) rows = rows.filter((r) => r.id === idFilter);
      if (wantState) rows = rows.filter((r) => r.state === wantState);
      if (wantOrigin) rows = rows.filter((r) => r.origin === wantOrigin);
      // stale sweep filters updated_at lt cutoff
      const updatedLt = url.searchParams.get('updated_at');
      if (updatedLt?.startsWith('lt.')) {
        const cutoff = Date.parse(updatedLt.slice(3));
        rows = rows.filter((r) => Date.parse(r.updated_at || 0) < cutoff);
      }
      return json(res, 200, rows);
    }
    if (url.pathname === '/rest/v1/proposals' && req.method === 'PATCH') {
      const idFilter = (url.searchParams.get('id') || '').replace('eq.', '');
      const reqState = (url.searchParams.get('state') || '').replace('eq.', '');
      const staleState = url.searchParams.get('state') === 'eq.drafting' && url.searchParams.get('updated_at');
      const patch = await readBody(req);
      const updated = [];
      for (const r of state.rows.values()) {
        if (idFilter && r.id !== idFilter) continue;
        if (staleState) {
          if (r.state !== 'drafting') continue;
          const updatedLt = url.searchParams.get('updated_at');
          if (updatedLt?.startsWith('lt.') && Date.parse(r.updated_at || 0) >= Date.parse(updatedLt.slice(3))) continue;
        } else if (reqState && r.state !== reqState) {
          continue; // state-filtered PATCH missed (optimistic lock)
        }
        Object.assign(r, patch, { updated_at: new Date().toISOString() });
        updated.push({ ...r });
      }
      return json(res, 200, updated);
    }

    // ── GitHub ──
    if (url.pathname === `/repos/Expensify/App/issues/${state.issue.number}` && req.method === 'GET') {
      return json(res, 200, state.issue);
    }
    if (url.pathname.endsWith(`/issues/${state.issue.number}/comments`) && req.method === 'GET') {
      return json(res, 200, []);
    }
    if (url.pathname.endsWith(`/issues/${state.issue.number}/comments`) && req.method === 'POST') {
      const body = await readBody(req);
      state.commentPosts.push(body);
      return json(res, 201, { id: 555, html_url: 'https://example.test/c/555' });
    }
    const patchMatch = url.pathname.match(/\/issues\/comments\/(\d+)$/);
    if (patchMatch && req.method === 'PATCH') {
      const body = await readBody(req);
      state.commentPatches.push({ id: Number(patchMatch[1]), body: body.body });
      return json(res, 200, { id: Number(patchMatch[1]) });
    }
    json(res, 404, { path: url.pathname, method: req.method });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const output = [];
  const worker = spawn(process.execPath, ['drafter.mjs'], {
    cwd: DRAFTER,
    env: {
      ...process.env,
      PATH: process.env.PATH,
      SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      SUPABASE_USER_ID: 'user-1',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      GITHUB_TOKEN: 't',
      REPO: 'Expensify/App',
      REPO_DIR: repoDir,
      DATA_DIR: repoDir,
      CODEX_HOME: path.join(codexDir, 'home'),
      DRY_RUN: 'false',
      POLL_INTERVAL_MS: '40',
      STALE_SWEEP_MS: '20',
      FAKE_CODEX_DIR: codexDir,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (c) => output.push(c.toString()));
  worker.stderr.on('data', (c) => output.push(c.toString()));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = async (pred, ms, msg) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return;
      await wait(15);
    }
    throw new Error(`${name}: ${msg}\n---\n${output.join('')}`);
  };

  try {
    await run(state, { deadline, wait, output, codexDir });
    console.log(`PASS ${name}`);
  } finally {
    worker.kill('SIGTERM');
    server.close();
  }
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const baseIssue = (over = {}) => ({
  number: 90001,
  title: 'Amount input crashes when blurred empty',
  body: 'Repro: focus the amount field, clear it, blur. Expected: shows 0. Actual: crash.',
  state: 'open',
  labels: [{ name: 'Bug' }, { name: 'Daily' }],
  ...over,
});

// The fake codex needs to run as `codex.mjs`. CODEX_BIN can't easily be "node
// codex.mjs" (single binary), so we write a tiny shell shim that execs node.
function makeShim() {
  const shimDir = mkdtempSync(path.join(tmpdir(), 'drafter-shim-'));
  const shim = path.join(shimDir, 'codex');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "$CODEX_SCRIPT" "$@"\n`);
  chmodSync(shim, 0o755);
  return shim;
}
const SHIM = makeShim();
const SCRIPT_DIR = mkdtempSync(path.join(tmpdir(), 'drafter-script-'));
const SCRIPT = path.join(SCRIPT_DIR, 'codex.mjs');
writeFileSync(SCRIPT, FAKE_CODEX);

// ── scenario 1: happy path queued → armed ────────────────────────────────────
await runScenario({
  name: 'draft-and-arm',
  env: { CODEX_BIN: SHIM, CODEX_SCRIPT: SCRIPT },
  issue: baseIssue(),
  cannedProposals: [GOOD_PROPOSAL],
  seedRows: [
    { id: 'r1', user_id: 'user-1', repo_owner: 'Expensify', repo_name: 'App', issue_number: 90001, body: '', state: 'queued', origin: 'auto', draft_attempts: 0, created_at: iso(-1000), updated_at: iso(-1000) },
  ],
  run: async (state, { deadline, codexDir }) => {
    await deadline(() => state.rows.get('r1')?.state === 'armed', 5000, 'row never armed');
    const r = state.rows.get('r1');
    assert.ok(r.body.includes('root cause'), 'armed body missing proposal content');
    assert.equal(state.commentPosts.length, 0, 'no direct post expected (no Help Wanted)');
    // The draft prompt must reference the bundled skill and carry the issue.
    const prompt = readFileSync(path.join(codexDir, 'last_prompt.txt'), 'utf8');
    assert.match(prompt, /expensify-proposal-writer\/SKILL\.md/, 'draft prompt did not reference the skill');
    assert.match(prompt, /proposal-rubric\.md/, 'draft prompt did not reference the rubric');
    assert.match(prompt, /Amount input crashes when blurred empty/, 'draft prompt missing the issue title');
    assert.doesNotMatch(prompt, /<<<(SKILL_DIR|ISSUE)>>>/, 'prompt placeholders not substituted');
  },
});

// ── scenario 2: validator rejects → draft ────────────────────────────────────
await runScenario({
  name: 'validator-reject',
  env: { CODEX_BIN: SHIM, CODEX_SCRIPT: SCRIPT },
  issue: baseIssue({ number: 90002 }),
  // both attempts return a proposal missing the second required heading
  cannedProposals: [MISSING_HEADING, MISSING_HEADING],
  seedRows: [
    { id: 'r2', user_id: 'user-1', repo_owner: 'Expensify', repo_name: 'App', issue_number: 90002, body: '', state: 'queued', origin: 'auto', draft_attempts: 0, created_at: iso(-1000), updated_at: iso(-1000) },
  ],
  run: async (state, { deadline }) => {
    await deadline(() => state.rows.get('r2')?.state === 'draft', 5000, 'row never dropped to draft');
    const r = state.rows.get('r2');
    assert.match(r.last_error || '', /failed validation/i, 'no validation error recorded');
    assert.notEqual(r.state, 'armed', 'invalid proposal was armed');
  },
});

// ── scenario 3: already Help Wanted → direct post ────────────────────────────
await runScenario({
  name: 'direct-post',
  env: { CODEX_BIN: SHIM, CODEX_SCRIPT: SCRIPT },
  issue: baseIssue({ number: 90003, labels: [{ name: 'Help Wanted' }] }),
  cannedProposals: [GOOD_PROPOSAL],
  seedRows: [
    { id: 'r3', user_id: 'user-1', repo_owner: 'Expensify', repo_name: 'App', issue_number: 90003, body: '', state: 'queued', origin: 'auto', draft_attempts: 0, created_at: iso(-1000), updated_at: iso(-1000) },
  ],
  run: async (state, { deadline }) => {
    await deadline(() => state.rows.get('r3')?.state === 'posted', 5000, 'row never posted');
    assert.equal(state.commentPosts.length, 1, 'expected exactly one direct post');
    assert.equal(state.rows.get('r3').github_comment_id, 555);
  },
});

// ── scenario 4: enrich edits the posted comment ──────────────────────────────
await runScenario({
  name: 'enrich-posted',
  env: { CODEX_BIN: SHIM, CODEX_SCRIPT: SCRIPT, ENRICH: 'true' },
  issue: baseIssue({ number: 90004, labels: [{ name: 'Help Wanted' }] }),
  // 1st = draft (posted), 2nd = enrichment (edits the comment). The marker goes
  // in the body text, never in a required heading.
  cannedProposals: [GOOD_PROPOSAL, GOOD_PROPOSAL.replace('I think we should', 'After checking git history (enriched), I think we should')],
  seedRows: [
    { id: 'r4', user_id: 'user-1', repo_owner: 'Expensify', repo_name: 'App', issue_number: 90004, body: '', state: 'queued', origin: 'auto', draft_attempts: 0, created_at: iso(-1000), updated_at: iso(-1000) },
  ],
  run: async (state, { deadline }) => {
    await deadline(() => state.commentPatches.length > 0, 6000, 'enrichment never edited the comment');
    assert.equal(state.commentPatches[0].id, 555);
    assert.match(state.commentPatches[0].body, /enriched/, 'enriched body not sent');
    await deadline(() => state.rows.get('r4')?.enriched_at != null, 2000, 'enriched_at not set');
  },
});

// ── scenario 5: manual row is never drafted ──────────────────────────────────
await runScenario({
  name: 'manual-untouched',
  env: { CODEX_BIN: SHIM, CODEX_SCRIPT: SCRIPT },
  issue: baseIssue({ number: 90005 }),
  cannedProposals: [GOOD_PROPOSAL],
  seedRows: [
    { id: 'r5', user_id: 'user-1', repo_owner: 'Expensify', repo_name: 'App', issue_number: 90005, body: 'my hand-written draft', state: 'queued', origin: 'manual', draft_attempts: 0, created_at: iso(-1000), updated_at: iso(-1000) },
  ],
  run: async (state, { wait }) => {
    await wait(600); // several poll cycles
    const r = state.rows.get('r5');
    assert.equal(r.state, 'queued', `manual row was touched (now ${r.state})`);
    assert.equal(r.body, 'my hand-written draft', 'manual body was overwritten');
    assert.equal(state.commentPosts.length, 0);
  },
});

// ── scenario 6: stale drafting row recovered ─────────────────────────────────
await runScenario({
  name: 'stale-recovery',
  env: { CODEX_BIN: SHIM, CODEX_SCRIPT: SCRIPT, STALE_DRAFTING_MS: '1000' },
  issue: baseIssue({ number: 90006 }),
  cannedProposals: [GOOD_PROPOSAL],
  seedRows: [
    { id: 'r6', user_id: 'user-1', repo_owner: 'Expensify', repo_name: 'App', issue_number: 90006, body: '', state: 'drafting', origin: 'auto', draft_attempts: 1, created_at: iso(-10000), updated_at: iso(-10000) },
  ],
  run: async (state, { deadline }) => {
    // stale drafting → re-queued, then picked up and armed
    await deadline(() => ['queued', 'drafting', 'armed'].includes(state.rows.get('r6')?.state) && state.rows.get('r6')?.last_error?.includes('stale') || state.rows.get('r6')?.state === 'armed', 5000, 'stale row not recovered');
    // and it eventually arms
    await deadline(() => state.rows.get('r6')?.state === 'armed', 5000, 'recovered row never armed');
  },
});

console.log('ALL PASS');
