#!/usr/bin/env node
/**
 * Auto-draft queueing test for the sniper.
 *
 * Verifies the discovery-loop matching that enqueues label-matched issues into
 * Supabase for the drafter worker: extension-identical AND-within-group /
 * OR-across-groups / exclusion semantics, seed-on-first-scan, idempotency, and
 * that armed issues are never re-queued.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : null;
}

async function runScenario({ name, env, issues, run, settings, events }) {
  const state = {
    issues, // [{ number, labels: [{name}], updated_at }]
    inserts: [], // POST /rest/v1/proposals bodies that were accepted
    existingKeys: new Set(), // "owner/repo#number" that already have a row
    settings, // extra user_settings columns (watched_label_groups, excluded_labels)
    events, // { "<issue number>": [{ event, label: { name } }] }
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/rest/v1/user_settings') {
      return json(res, 200, [{ proposal_auto_post: true, ...(state.settings || {}) }]);
    }
    // The sniper's armed-proposal sync (cloud mode) queries armed rows.
    if (url.pathname === '/rest/v1/proposals' && req.method === 'GET') {
      return json(res, 200, []);
    }
    if (url.pathname === '/rest/v1/proposals' && req.method === 'POST') {
      const body = await readBody(req);
      const key = `${body.repo_owner}/${body.repo_name}#${body.issue_number}`;
      if (state.existingKeys.has(key)) {
        // ignore-duplicates → no row returned
        return json(res, 201, []);
      }
      state.existingKeys.add(key);
      state.inserts.push(body);
      return json(res, 201, [{ ...body, id: `p-${body.issue_number}` }]);
    }
    // Label history, keyed by issue number; absent means "no events".
    const evMatch = url.pathname.match(/^\/repos\/Expensify\/App\/issues\/(\d+)\/events$/);
    if (evMatch) {
      return json(res, 200, (state.events || {})[evMatch[1]] || []);
    }
    if (url.pathname === '/repos/Expensify/App/issues') {
      return json(
        res,
        200,
        // Fresh by default so the max-age gate passes; a scenario can override
        // created_at to test a bumped old issue.
        state.issues.map((i) => ({ created_at: new Date().toISOString(), ...i, state: 'open' })),
      );
    }
    // No tight/fire path is exercised here.
    json(res, 200, []);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const output = [];
  const worker = spawn(process.execPath, ['sniper.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      GITHUB_TOKEN: 't',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      SUPABASE_USER_ID: 'user-1',
      REPO: 'Expensify/App',
      DRY_RUN: 'false',
      DISCOVER: 'false',
      ALERT_NEW_TRIGGER: 'false',
      ARMED_SYNC_INTERVAL_MS: '20',
      DISCOVERY_INTERVAL_MS: '20',
      REQUEST_BUDGET_PER_MIN: '100000',
      AUTO_DRAFT: 'true',
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
      await wait(10);
    }
    throw new Error(`${name}: ${msg}\n---\n${output.join('')}`);
  };

  try {
    await deadline(() => output.join('').includes('auto-draft queueing on'), 2000, 'auto-draft never started');
    await run(state, { deadline, wait, output });
    console.log(`PASS ${name}`);
  } finally {
    worker.kill('SIGTERM');
    server.close();
  }
}

const L = (...names) => names.map((name) => ({ name }));
const iso = '2026-07-17T00:00:00Z';

// ── scenario 1: AND within group, OR across groups, seed-then-queue ──────────
await runScenario({
  name: 'match-and-seed',
  env: { WATCH_GROUPS: 'Help Wanted|Bug+daily', EXCLUDE_LABELS: 'reviewing' },
  issues: [
    { number: 5001, title: 'has HW', labels: L('Help Wanted'), updated_at: iso },
    { number: 5002, title: 'bug only, no match', labels: L('Bug'), updated_at: iso },
  ],
  run: async (state, { deadline, wait }) => {
    // First scan seeds the existing matches — nothing enqueued.
    await wait(300);
    assert.equal(state.inserts.length, 0, `seed scan enqueued ${state.inserts.length} rows`);

    // A new issue matching the Bug+daily group (AND) appears.
    state.issues.push({ number: 5003, title: 'bug+daily', labels: L('Bug', 'Daily'), updated_at: iso });
    // A new issue with only one of the two group labels must NOT match.
    state.issues.push({ number: 5004, title: 'daily only', labels: L('Daily'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 5003), 2000, '#5003 (Bug+Daily) not queued');
    await wait(300);
    assert.ok(!state.inserts.some((r) => r.issue_number === 5004), '#5004 (Daily only) wrongly queued');
    const r = state.inserts.find((x) => x.issue_number === 5003);
    assert.equal(r.state, 'queued');
    assert.equal(r.origin, 'auto');
    assert.equal(r.user_id, 'user-1');
  },
});

// ── scenario 2: exclusion + idempotency across re-scans ──────────────────────
await runScenario({
  name: 'exclude-and-idempotent',
  env: { WATCH_GROUPS: 'Bug', EXCLUDE_LABELS: 'reviewing,DeployBlocker' },
  issues: [{ number: 6001, title: 'seed', labels: L('Bug'), updated_at: iso }],
  run: async (state, { deadline, wait }) => {
    await wait(200); // seed

    // Matches Bug but also carries an excluded label → must be skipped.
    state.issues.push({ number: 6002, title: 'excluded', labels: L('Bug', 'reviewing'), updated_at: iso });
    // Clean match.
    state.issues.push({ number: 6003, title: 'clean', labels: L('Bug'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 6003), 2000, '#6003 not queued');
    await wait(400); // several more discovery ticks
    assert.ok(!state.inserts.some((r) => r.issue_number === 6002), 'excluded #6002 was queued');
    const count6003 = state.inserts.filter((r) => r.issue_number === 6003).length;
    assert.equal(count6003, 1, `#6003 queued ${count6003} times (should be exactly 1)`);
  },
});

// ── scenario 3: extension-synced config overrides the env defaults ───────────
await runScenario({
  name: 'extension-config-overrides-env',
  // Env says watch "Bug"; the extension has synced "Performance" + exclude "reviewing".
  env: { WATCH_GROUPS: 'Bug', EXCLUDE_LABELS: '' },
  settings: { watched_label_groups: [['Performance']], excluded_labels: ['reviewing'] },
  issues: [{ number: 7001, title: 'seed', labels: L('Performance'), updated_at: iso }],
  run: async (state, { deadline, wait, output }) => {
    // Startup uses env until the first settings sync adopts the extension config.
    await deadline(() => output.join('').includes('watch config from extension'), 2000, 'never adopted extension config');
    await wait(200); // let it re-seed under the new rules

    // A new Performance issue (extension group) must queue; a Bug issue (old env
    // group, now overridden) must NOT.
    state.issues.push({ number: 7002, title: 'perf', labels: L('Performance'), updated_at: iso });
    state.issues.push({ number: 7003, title: 'bug-old-env', labels: L('Bug'), updated_at: iso });
    // And an excluded one must be skipped.
    state.issues.push({ number: 7004, title: 'excluded', labels: L('Performance', 'reviewing'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 7002), 2000, '#7002 (Performance) not queued');
    await wait(300);
    assert.ok(!state.inserts.some((r) => r.issue_number === 7003), '#7003 (Bug, env-only) wrongly queued');
    assert.ok(!state.inserts.some((r) => r.issue_number === 7004), 'excluded #7004 was queued');
  },
});

// ── scenario 4: skip Help Wanted, but queue with or without External ─────────
// The drafter, not the sniper, decides when to start: `External` present means
// draft now, absent means wait DRAFT_DELAY_MS. Both states must reach the queue.
await runScenario({
  name: 'skip-help-wanted-queue-either-side-of-external',
  env: { WATCH_GROUPS: 'Bug+daily', EXCLUDE_LABELS: '' },
  issues: [{ number: 8001, title: 'seed', labels: L('Bug', 'Daily'), updated_at: iso }],
  run: async (state, { deadline, wait }) => {
    await wait(200); // seed

    // Matches Bug+daily but already has Help Wanted → too late, must be skipped.
    state.issues.push({ number: 8002, title: 'already HW', labels: L('Bug', 'Daily', 'Help Wanted'), updated_at: iso });
    // External already on → queued, and the drafter starts immediately.
    state.issues.push({ number: 8003, title: 'already External', labels: L('Bug', 'Daily', 'External'), updated_at: iso });
    // No External yet → queued, and the drafter waits for it.
    state.issues.push({ number: 8004, title: 'pre-External', labels: L('Bug', 'Daily'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 8004), 2000, '#8004 (pre-External) not queued');
    await deadline(() => state.inserts.some((r) => r.issue_number === 8003), 2000, '#8003 (has External) not queued');
    await wait(300);
    assert.ok(!state.inserts.some((r) => r.issue_number === 8002), '#8002 (has Help Wanted) wrongly queued');
  },
});

// ── scenario 5: a dead issue is never queued ─────────────────────────────────
// Awaiting Payment / Internal issues keep Bug+Daily+External and lose Help
// Wanted, so they match the groups exactly like a fresh one.
await runScenario({
  name: 'skip-dead-labels',
  env: { WATCH_GROUPS: 'Bug+daily', EXCLUDE_LABELS: '' },
  issues: [{ number: 9001, title: 'seed', labels: L('Bug', 'Daily'), updated_at: iso }],
  run: async (state, { deadline, wait }) => {
    await wait(200); // seed

    state.issues.push({ number: 9002, title: 'paid out', labels: L('Bug', 'Daily', 'External', 'Awaiting Payment'), updated_at: iso });
    state.issues.push({ number: 9003, title: 'staff took it', labels: L('Bug', 'Daily', 'External', 'Internal'), updated_at: iso });
    state.issues.push({ number: 9004, title: 'live', labels: L('Bug', 'Daily', 'External'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 9004), 2000, '#9004 (live) not queued');
    await wait(300);
    assert.ok(!state.inserts.some((r) => r.issue_number === 9002), '#9002 (Awaiting Payment) wrongly queued');
    assert.ok(!state.inserts.some((r) => r.issue_number === 9003), '#9003 (Internal) wrongly queued');
  },
});

// ── scenario 6: a bumped old issue is not queued ─────────────────────────────
// Help Wanted is absent both before the race and after it. An old issue back on
// the discovery page (the Overdue bot bumps them) already had its race, so
// drafting it is spend with no chance of a win.
await runScenario({
  name: 'skip-stale-issues',
  env: { WATCH_GROUPS: 'Bug+daily', EXCLUDE_LABELS: '', MAX_ISSUE_AGE_DAYS: '7' },
  issues: [{ number: 10001, title: 'seed', labels: L('Bug', 'Daily'), updated_at: iso }],
  run: async (state, { deadline, wait }) => {
    await wait(200); // seed

    const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
    // Bumped a minute ago, but opened 40 days ago → its race is long over.
    state.issues.push({ number: 10002, title: 'bumped old', labels: L('Bug', 'Daily', 'External'), created_at: daysAgo(40), updated_at: iso });
    // Just opened → still ahead of Help Wanted.
    state.issues.push({ number: 10003, title: 'fresh', labels: L('Bug', 'Daily', 'External'), created_at: daysAgo(0), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 10003), 2000, '#10003 (fresh) not queued');
    await wait(300);
    assert.ok(!state.inserts.some((r) => r.issue_number === 10002), '#10002 (40 days old) wrongly queued');
  },
});

// ── scenario 7: an issue that already had Help Wanted is not queued ──────────
// Expensify strips Help Wanted on assignment, so a finished race looks exactly
// like one that hasn't started. Only the event log tells them apart, and it
// catches issues too young for the age gate.
await runScenario({
  name: 'skip-already-raced',
  env: { WATCH_GROUPS: 'Bug+daily', EXCLUDE_LABELS: '' },
  issues: [{ number: 11001, title: 'seed', labels: L('Bug', 'Daily'), updated_at: iso }],
  events: {
    // Fresh issue, but Help Wanted came and went — someone already won it.
    11002: [
      { event: 'labeled', label: { name: 'External' } },
      { event: 'labeled', label: { name: 'Help Wanted' } },
      { event: 'unlabeled', label: { name: 'Help Wanted' } },
    ],
    // Never opened to contributors — still winnable.
    11003: [{ event: 'labeled', label: { name: 'External' } }],
  },
  run: async (state, { deadline, wait }) => {
    await wait(200); // seed

    state.issues.push({ number: 11002, title: 'already raced', labels: L('Bug', 'Daily', 'External'), updated_at: iso });
    state.issues.push({ number: 11003, title: 'never raced', labels: L('Bug', 'Daily', 'External'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 11003), 2000, '#11003 (never raced) not queued');
    await wait(300);
    assert.ok(!state.inserts.some((r) => r.issue_number === 11002), '#11002 (already raced) wrongly queued');
  },
});

console.log('ALL PASS');
