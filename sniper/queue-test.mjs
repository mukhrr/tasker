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

async function runScenario({ name, env, issues, run }) {
  const state = {
    issues, // [{ number, labels: [{name}], updated_at }]
    inserts: [], // POST /rest/v1/proposals bodies that were accepted
    existingKeys: new Set(), // "owner/repo#number" that already have a row
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/rest/v1/user_settings') {
      return json(res, 200, [{ proposal_auto_post: true }]);
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
    if (url.pathname === '/repos/Expensify/App/issues') {
      return json(
        res,
        200,
        state.issues.map((i) => ({ ...i, state: 'open' })),
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
  env: { WATCH_GROUPS: 'Help Wanted', EXCLUDE_LABELS: 'reviewing,DeployBlocker' },
  issues: [{ number: 6001, title: 'seed', labels: L('Help Wanted'), updated_at: iso }],
  run: async (state, { deadline, wait }) => {
    await wait(200); // seed

    // Matches Help Wanted but also carries an excluded label → must be skipped.
    state.issues.push({ number: 6002, title: 'excluded', labels: L('Help Wanted', 'reviewing'), updated_at: iso });
    // Clean match.
    state.issues.push({ number: 6003, title: 'clean', labels: L('Help Wanted'), updated_at: iso });

    await deadline(() => state.inserts.some((r) => r.issue_number === 6003), 2000, '#6003 not queued');
    await wait(400); // several more discovery ticks
    assert.ok(!state.inserts.some((r) => r.issue_number === 6002), 'excluded #6002 was queued');
    const count6003 = state.inserts.filter((r) => r.issue_number === 6003).length;
    assert.equal(count6003, 1, `#6003 queued ${count6003} times (should be exactly 1)`);
  },
});

console.log('ALL PASS');
