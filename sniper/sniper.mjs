#!/usr/bin/env node
/**
 * Tasker proposal sniper — always-on, server-side.
 *
 * Races the Expensify `Help Wanted` label and posts a pre-staged proposal
 * within ~100-300ms of the label landing — far ahead of a browser tab, which
 * is throttled by Chrome MV3 service-worker cold-starts and only watches one
 * open issue at a time.
 *
 * Strategy (confirmed against real issue timing on Expensify/App):
 *   - Proposals must be posted AFTER the `Help Wanted` label (posting in the
 *     External→Help Wanted gap is not accepted).
 *   - Melvin applies `External` ~2-3s BEFORE `Help Wanted`, so we LOCK onto an
 *     issue the instant it gets `External`, tight-poll its labels at ~80ms, and
 *     FIRE the moment `Help Wanted` appears. Label polls are ETag-conditional,
 *     so the in-window burst is almost entirely free 304s.
 *
 * Two ways to feed it issues:
 *   WATCH=92367,92400   → race these specific issues you've staged a body for
 *   DISCOVER=true       → watch the whole repo: lock on `External`, fire on HW
 *
 * Safety: DRY_RUN=true (default) logs what it WOULD post — nothing is posted.
 * ⚠️  Posting a generic body to EVERY Help Wanted issue is spam and WILL get you
 *     banned. DISCOVER mode is for a narrow, honest workflow where you actually
 *     intend to follow up each snipe with a real proposal. Be selective.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── config ──────────────────────────────────────────────────────────────────
const TOKEN = required('GITHUB_TOKEN'); // classic PAT with `public_repo` scope
const REPO = process.env.REPO || 'Expensify/App';
const LOCK_NAME = process.env.LABEL_LOCK || 'External';
const TRIGGER_NAME = process.env.LABEL_TRIGGER || 'Help Wanted';
const LOCK = LOCK_NAME.toLowerCase();
const TRIGGER = TRIGGER_NAME.toLowerCase();

const DISCOVERY_INTERVAL_MS = int('DISCOVERY_INTERVAL_MS', 600); // repo + slow per-issue poll
const TIGHT_INTERVAL_MS = int('TIGHT_INTERVAL_MS', 80); // poll once External is seen
const TIGHT_WINDOW_MS = int('TIGHT_WINDOW_MS', 15000); // max time to tight-poll one issue
const FRESH_LOCK_MS = int('FRESH_LOCK_MS', 20000); // only lock issues updated this recently
const FIRE_FRESH_MS = int('FIRE_FRESH_MS', 8000); // catch-up fire only if HW this fresh

const DRY_RUN = bool('DRY_RUN', true);
const DISCOVER = bool('DISCOVER', false);
const WATCH = (process.env.WATCH || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);

const PROPOSAL_DIR = process.env.PROPOSAL_DIR || path.join(HERE, 'proposals');
const DEFAULT_BODY_FILE = process.env.PROPOSAL_FILE || path.join(HERE, 'proposal.md');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

const API = 'https://api.github.com';
const START = Date.now();

// ── state ───────────────────────────────────────────────────────────────────
const posted = new Set(); // issue numbers we've already fired on
const tracked = new Map(); // n -> { mode:'slow'|'tight', isWatch, tightUntil, issue }
const etags = new Map(); // request key -> last ETag (for conditional GETs)
let backoffUntil = 0;

// ── GitHub fetch (conditional + rate-limit aware) ─────────────────────────────
async function gh(p, { method = 'GET', body, useEtag = false, key } = {}) {
  if (Date.now() < backoffUntil) return { status: 429, data: null };
  const url = p.startsWith('http') ? p : API + p;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'tasker-sniper',
  };
  const k = key || url;
  if (useEtag && etags.has(k)) headers['If-None-Match'] = etags.get(k);
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    return { status: 0, data: null, error: e.message };
  }

  if (useEtag) {
    const et = res.headers.get('etag');
    if (et) etags.set(k, et);
  }

  if (res.status === 403 || res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const reset = parseInt(res.headers.get('x-ratelimit-reset') || '', 10);
    let waitMs = 60000;
    if (!Number.isNaN(retryAfter)) waitMs = retryAfter * 1000;
    else if (res.headers.get('x-ratelimit-remaining') === '0' && reset) {
      waitMs = Math.max(1000, reset * 1000 - Date.now());
    }
    backoffUntil = Date.now() + waitMs;
    log(`⏸️  rate-limited (${res.status}) — backing off ${Math.round(waitMs / 1000)}s`);
    return { status: res.status, data: null };
  }
  if (res.status === 304) return { status: 304, data: null };

  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

// ── discovery: find issues that just got `External` (repo-wide) ───────────────
async function discoverTick() {
  const q =
    `/repos/${REPO}/issues?labels=${encodeURIComponent(LOCK_NAME)}` +
    `&state=open&sort=updated&direction=desc&per_page=20`;
  const { status, data } = await gh(q, { useEtag: true, key: 'discover' });
  if (status === 200 && Array.isArray(data)) {
    for (const issue of data) {
      if (issue.pull_request) continue; // the issues endpoint also returns PRs
      const n = issue.number;
      if (posted.has(n) || tracked.has(n)) continue;
      const names = labelNames(issue.labels);
      const hasHW = names.includes(TRIGGER);
      const updatedAgo = Date.now() - Date.parse(issue.updated_at);
      if (!hasHW && updatedAgo < FRESH_LOCK_MS) {
        // Fresh `External`, no HW yet — exactly the pre-HW window. Lock tight.
        track(n, { mode: 'tight', issue });
      } else if (hasHW && updatedAgo < FIRE_FRESH_MS && Date.parse(issue.updated_at) > START) {
        // Both labels already on but HW is fresh and landed after we started —
        // we missed the pre-lock; fire a catch-up (still likely top-of-pack).
        void fire(n, issue, 'discover-hw-fresh');
      }
    }
  }
  setTimeout(discoverTick, DISCOVERY_INTERVAL_MS);
}

// ── per-issue tracker: slow until `External`, then tight until `Help Wanted` ──
function track(n, { isWatch = false, mode = 'slow', issue = null } = {}) {
  if (posted.has(n)) return;
  const existing = tracked.get(n);
  if (existing) {
    if (issue) existing.issue = issue;
    if (mode === 'tight' && existing.mode !== 'tight') upgradeToTight(n, existing);
    return;
  }
  const st = { mode, isWatch, issue, tightUntil: mode === 'tight' ? Date.now() + TIGHT_WINDOW_MS : 0 };
  tracked.set(n, st);
  log(mode === 'tight' ? `🔒 #${n} locked (tight) via discovery` : `👁  #${n} watching`);
  void tick(n);
}

function upgradeToTight(n, st) {
  st.mode = 'tight';
  st.tightUntil = Date.now() + TIGHT_WINDOW_MS;
  log(`⚡ #${n} "${LOCK_NAME}" seen → tight-polling for "${TRIGGER_NAME}"`);
}

async function tick(n) {
  let st = tracked.get(n);
  if (!st || posted.has(n)) return;

  const { status, data } = await gh(`/repos/${REPO}/issues/${n}/labels`, {
    useEtag: true,
    key: `labels-${n}`,
  });

  st = tracked.get(n);
  if (!st || posted.has(n)) return;

  if (status === 200 && Array.isArray(data)) {
    const names = labelNames(data);
    if (names.includes(TRIGGER)) {
      void fire(n, st.issue, st.mode === 'tight' ? 'tight-poll' : 'slow-poll');
      return;
    }
    if (names.includes(LOCK) && st.mode !== 'tight') upgradeToTight(n, st);
  }

  if (st.mode === 'tight' && Date.now() > st.tightUntil) {
    if (st.isWatch) {
      st.mode = 'slow'; // watched issue — drop back to slow and keep waiting
      log(`#${n} tight window elapsed → back to slow watch`);
    } else {
      tracked.delete(n); // discovered candidate that never reached HW — drop it
      log(`⌛ #${n} dropped (no "${TRIGGER_NAME}" within tight window)`);
      return;
    }
  }

  const interval = st.mode === 'tight' ? TIGHT_INTERVAL_MS : DISCOVERY_INTERVAL_MS;
  setTimeout(() => void tick(n), interval);
}

// ── fire: post the staged proposal ────────────────────────────────────────────
async function fire(n, issue, via) {
  if (posted.has(n)) return;
  posted.add(n);
  tracked.delete(n);

  const body = await bodyFor(n);
  const title = issue?.title ? ` — ${issue.title}` : '';
  const issueUrl = `https://github.com/${REPO}/issues/${n}`;

  if (DRY_RUN) {
    log(`🧪 DRY_RUN: would POST proposal to #${n} (via ${via}, ${body.length} chars)${title}`);
    await notify(`🧪 [dry-run] would snipe #${n}${title}\n${issueUrl}`);
    return;
  }

  const t0 = Date.now();
  const { status, data } = await gh(`/repos/${REPO}/issues/${n}/comments`, {
    method: 'POST',
    body: { body },
  });
  const dt = Date.now() - t0;

  if (status === 201 && data?.html_url) {
    log(`✅ sniped #${n} via ${via} in ${dt}ms → ${data.html_url}`);
    await notify(`✅ Sniped #${n} in ${dt}ms${title}\nGo edit your proposal:\n${data.html_url}`);
  } else {
    posted.delete(n); // allow a retry on transient failures
    const detail = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
    log(`❌ post #${n} failed: ${status} ${detail}`);
    await notify(`❌ Snipe #${n} failed (HTTP ${status})`);
  }
}

// ── proposal body resolution ──────────────────────────────────────────────────
async function bodyFor(n) {
  const perIssue = path.join(PROPOSAL_DIR, `${n}.md`);
  if (existsSync(perIssue)) return (await readFile(perIssue, 'utf8')).trim();
  if (existsSync(DEFAULT_BODY_FILE)) return (await readFile(DEFAULT_BODY_FILE, 'utf8')).trim();
  return (
    process.env.PROPOSAL_BODY ||
    '## Proposal\n\n_Reviewing this issue — a detailed proposal is on the way._'
  );
}

// ── telegram notify (optional) ────────────────────────────────────────────────
async function notify(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text }),
    });
  } catch (e) {
    log(`telegram err: ${e.message}`);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function labelNames(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
}
function required(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing required env ${k}`);
    process.exit(1);
  }
  return v;
}
function int(k, d) {
  const v = process.env[k];
  return v ? parseInt(v, 10) : d;
}
function bool(k, d) {
  const v = process.env[k];
  if (v == null) return d;
  return /^(1|true|yes|on)$/i.test(v);
}
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  if (!DISCOVER && WATCH.length === 0) {
    console.error('Nothing to do — set WATCH=<issue#,...> and/or DISCOVER=true');
    process.exit(1);
  }
  log(
    `sniper up — repo=${REPO} ` +
      `${DISCOVER ? 'discover=on ' : ''}` +
      `${WATCH.length ? `watch=[${WATCH.join(',')}] ` : ''}` +
      `dryRun=${DRY_RUN} tight=${TIGHT_INTERVAL_MS}ms`
  );
  if (DISCOVER && !DRY_RUN) {
    log(
      '⚠️  DISCOVER + live posting: only run this if you genuinely intend to ' +
        'follow up every snipe with a real proposal. Blanket auto-posting is a ban risk.'
    );
  }

  for (const n of WATCH) track(n, { isWatch: true, mode: 'slow' });
  if (DISCOVER) void discoverTick();
}

main();
