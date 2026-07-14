#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

const ISSUE = 99999;
const proposal = {
  id: 'stress-proposal',
  user_id: 'stress-user',
  repo_owner: 'Expensify',
  repo_name: 'App',
  issue_number: ISSUE,
  body: '## Proposal\n\nStress-test proposal.',
  state: 'armed',
  updated_at: new Date().toISOString(),
};

let labels = [];
let updatedAt = new Date().toISOString();
let events = [];
let eventRequests = 0;
let labelPolls = 0;
let commentPosts = 0;
let firstPostAt = 0;
let successfulPostAt = 0;

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/rest/v1/user_settings') {
    return json(res, 200, [{ proposal_auto_post: true }]);
  }
  if (url.pathname === '/rest/v1/proposals' && req.method === 'GET') {
    return json(res, 200, proposal.state === 'armed' ? [proposal] : []);
  }
  if (url.pathname === '/rest/v1/proposals' && req.method === 'PATCH') {
    if (url.searchParams.get('state') === 'eq.armed' && proposal.state !== 'armed') {
      return json(res, 200, []);
    }
    Object.assign(proposal, await readBody(req));
    return json(res, 200, req.headers.prefer === 'return=representation' ? [proposal] : null);
  }

  if (url.pathname === `/repos/Expensify/App/issues/${ISSUE}`) {
    return json(res, 200, { number: ISSUE, state: 'open', labels, updated_at: updatedAt });
  }
  if (url.pathname === '/repos/Expensify/App/issues') {
    return json(res, 200, [{ number: ISSUE, state: 'open', labels, updated_at: updatedAt }]);
  }
  if (url.pathname === `/repos/Expensify/App/issues/${ISSUE}/events`) {
    eventRequests += 1;
    return json(res, 200, events);
  }
  if (url.pathname === `/repos/Expensify/App/issues/${ISSUE}/labels`) {
    labelPolls += 1;
    return json(res, 200, labels);
  }
  if (url.pathname === `/repos/Expensify/App/issues/${ISSUE}/comments` && req.method === 'POST') {
    commentPosts += 1;
    if (commentPosts === 1) {
      firstPostAt = Date.now();
      return json(res, 403, { message: 'secondary rate limit' }, { 'retry-after': '1' });
    }
    successfulPostAt = Date.now();
    return json(res, 201, { id: 123, html_url: 'https://example.test/comment/123' });
  }

  json(res, 404, { method: req.method, path: url.pathname });
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const output = [];
const worker = spawn(process.execPath, ['sniper.mjs'], {
  cwd: new URL('.', import.meta.url),
  env: {
    ...process.env,
    GITHUB_TOKEN: 'stress-token',
    GITHUB_API_URL: `http://127.0.0.1:${port}`,
    SUPABASE_URL: `http://127.0.0.1:${port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'stress-service-key',
    SUPABASE_USER_ID: proposal.user_id,
    REPO: 'Expensify/App',
    DRY_RUN: 'false',
    DISCOVER: 'false',
    ARMED_SYNC_INTERVAL_MS: '10',
    DISCOVERY_INTERVAL_MS: '10',
    TIGHT_INTERVAL_MS: '5',
    TIGHT_WINDOW_MS: '500',
    FRESH_LOCK_MS: '1000',
    FIRE_FRESH_MS: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
worker.stdout.on('data', (chunk) => output.push(chunk.toString()));
worker.stderr.on('data', (chunk) => output.push(chunk.toString()));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = async (predicate, ms, message) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error(message);
};

try {
  await deadline(() => output.join('').includes('armed and staged'), 1000, 'worker did not arm');

  // Unrelated activity must never start the expensive per-issue label loop.
  for (let i = 0; i < 250; i += 1) {
    updatedAt = new Date(Date.now() + i).toISOString();
    await wait(1);
  }
  assert.equal(labelPolls, 0, 'unrelated updates opened a tight polling window');

  const externalAt = new Date().toISOString();
  labels = [{ name: 'External' }];
  updatedAt = externalAt;
  events = [{ event: 'labeled', label: { name: 'External' }, created_at: externalAt }];
  await deadline(() => labelPolls > 0, 1000, 'External event did not open tight polling');

  const helpWantedAt = Date.now();
  labels = [{ name: 'External' }, { name: 'Help Wanted' }];
  updatedAt = new Date(helpWantedAt).toISOString();
  events.push({ event: 'labeled', label: { name: 'Help Wanted' }, created_at: updatedAt });
  await deadline(() => commentPosts === 1, 1000, 'worker did not attempt the first post');
  assert.ok(firstPostAt - helpWantedAt < 150, `detection took ${firstPostAt - helpWantedAt}ms`);
  await deadline(() => commentPosts === 2 && proposal.state === 'posted', 4000, '403 was not retried');

  assert.equal(commentPosts, 2, 'worker posted more than the initial attempt and one retry');
  assert.ok(eventRequests <= 3, `event endpoint was called ${eventRequests} times`);
  assert.ok(labelPolls < 50, `tight loop made ${labelPolls} requests`);
  assert.ok(successfulPostAt > firstPostAt, 'retry did not happen after the rejected post');

  console.log(
    `PASS: 250 unrelated updates, ${labelPolls} tight polls, ` +
      `${firstPostAt - helpWantedAt}ms detection, 403 recovered with one retry`,
  );
} catch (error) {
  console.error(output.join(''));
  throw error;
} finally {
  worker.kill('SIGTERM');
  server.close();
}
