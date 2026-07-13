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
 *   Supabase variables  → continuously watch proposals armed in the extension
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

// One shared recent-open-issues request stays below GitHub's 5,000/hour primary
// limit. It catches both External → Help Wanted and direct Help Wanted changes.
const DISCOVERY_INTERVAL_MS = int('DISCOVERY_INTERVAL_MS', 900);
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
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_USER_ID = process.env.SUPABASE_USER_ID || '';
const ARMED_SYNC_INTERVAL_MS = int('ARMED_SYNC_INTERVAL_MS', 1000);
const CLOUD_MODE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_USER_ID);

const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const START = Date.now();

// ── state ───────────────────────────────────────────────────────────────────
const posted = new Set(); // issue numbers we've already fired on
const tracked = new Map(); // n -> { mode:'slow'|'tight', isWatch, tightUntil, issue }
const etags = new Map(); // request key -> last ETag (for conditional GETs)
const bodies = new Map(); // issue number -> Promise<string>; keeps disk I/O off the fire path
const cloudProposals = new Map(); // issue number -> armed Supabase proposal
const validatedCloudProposalIds = new Set(); // GitHub-open check, once per armed lifecycle
const cloudValidationBackoff = new Map(); // proposal id -> { attempts, retryAt }
let backoffUntil = 0;

// ── Supabase proposal source ─────────────────────────────────────────────────
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

async function syncArmedProposals() {
  const [owner, repo] = REPO.split('/');
  const settingsQuery = new URLSearchParams({
    select: 'proposal_auto_post',
    id: `eq.${SUPABASE_USER_ID}`,
    limit: '1',
  });
  const settingsRows = await supabaseRequest(`user_settings?${settingsQuery}`);
  const autoPostEnabled = !Array.isArray(settingsRows) || settingsRows[0]?.proposal_auto_post !== false;

  const query = new URLSearchParams({
    select: 'id,user_id,repo_owner,repo_name,issue_number,body,state',
    user_id: `eq.${SUPABASE_USER_ID}`,
    repo_owner: `ilike.${owner}`,
    repo_name: `ilike.${repo}`,
    state: 'eq.armed',
  });
  const rows = autoPostEnabled ? await supabaseRequest(`proposals?${query}`) : [];
  if (!Array.isArray(rows)) throw new Error('Supabase proposals response was not an array');

  const armedNow = new Set();
  const queriedProposalIds = new Set(rows.map((proposal) => proposal.id));
  for (const proposal of rows) {
    const n = Number(proposal.issue_number);
    const body = typeof proposal.body === 'string' ? proposal.body.trim() : '';
    if (!Number.isInteger(n) || n <= 0 || !body) continue;

    if (!validatedCloudProposalIds.has(proposal.id)) {
      const retry = cloudValidationBackoff.get(proposal.id);
      if (retry && Date.now() < retry.retryAt) continue;

      const { status, data, error } = await gh(`/repos/${REPO}/issues/${n}`);
      if (status !== 200 || !data || typeof data !== 'object') {
        const attempts = (retry?.attempts || 0) + 1;
        const delayMs = Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1));
        cloudValidationBackoff.set(proposal.id, { attempts, retryAt: Date.now() + delayMs });
        log(
          `GitHub state check failed for #${n} (${status}${error ? `: ${error}` : ''}); ` +
            `not staging, retry in ${Math.round(delayMs / 1000)}s`,
        );
        continue;
      }
      cloudValidationBackoff.delete(proposal.id);
      if (data.state !== 'open') {
        await updateCloudProposal(proposal.id, {
          state: 'draft',
          last_error: 'Auto-disarmed because the GitHub issue is closed.',
        });
        log(`🚫 #${n} is closed — auto-disarmed`);
        continue;
      }
      validatedCloudProposalIds.add(proposal.id);
    }

    armedNow.add(n);
    const wasKnown = cloudProposals.has(n);
    cloudProposals.set(n, proposal);
    bodies.set(n, Promise.resolve(body));
    if (!wasKnown) {
      posted.delete(n); // allow an intentionally re-armed issue in this process
      etags.delete('discover'); // re-evaluate an External label already in the cached page
      log(`📌 #${n} armed and staged`);
    }
  }

  for (const [n] of cloudProposals) {
    if (armedNow.has(n)) continue;
    const previous = cloudProposals.get(n);
    if (previous) {
      validatedCloudProposalIds.delete(previous.id);
      cloudValidationBackoff.delete(previous.id);
    }
    cloudProposals.delete(n);
    const st = tracked.get(n);
    if (st?.source === 'cloud') tracked.delete(n);
    if (!WATCH.includes(n)) bodies.delete(n);
  }
  for (const id of cloudValidationBackoff.keys()) {
    if (!queriedProposalIds.has(id)) cloudValidationBackoff.delete(id);
  }
}

async function cloudSyncTick() {
  try {
    await syncArmedProposals();
  } catch (e) {
    log(`Supabase sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  setTimeout(() => void cloudSyncTick(), ARMED_SYNC_INTERVAL_MS);
}

async function claimCloudProposal(proposal) {
  const query = new URLSearchParams({
    id: `eq.${proposal.id}`,
    user_id: `eq.${SUPABASE_USER_ID}`,
    state: 'eq.armed',
    select: '*',
  });
  const rows = await supabaseRequest(`proposals?${query}`, {
    method: 'PATCH',
    body: { state: 'posting', last_error: null },
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateCloudProposal(id, values) {
  const query = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${SUPABASE_USER_ID}` });
  await supabaseRequest(`proposals?${query}`, {
    method: 'PATCH',
    body: values,
    prefer: 'return=minimal',
  });
}

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

// ── discovery: inspect the repository's most recently updated open issues ────
async function discoverTick() {
  const q =
    `/repos/${REPO}/issues?state=open&sort=updated&direction=desc&per_page=50`;
  const { status, data } = await gh(q, { useEtag: true, key: 'discover' });
  if (status === 200 && Array.isArray(data)) {
    for (const issue of data) {
      if (issue.pull_request) continue; // the issues endpoint also returns PRs
      const n = issue.number;
      // Cloud mode is deliberately selective: the shared recent-issue detector
      // ignores everything except proposals explicitly armed in the extension.
      if (!DISCOVER && !cloudProposals.has(n)) continue;
      if (posted.has(n) || tracked.has(n)) continue;
      const names = labelNames(issue.labels);
      const hasHW = names.includes(TRIGGER);
      const updatedAgo = Date.now() - Date.parse(issue.updated_at);
      if (!hasHW && updatedAgo < FRESH_LOCK_MS) {
        // Fresh `External`, no HW yet — exactly the pre-HW window. Lock tight.
        track(n, {
          mode: 'tight',
          issue,
          isWatch: cloudProposals.has(n),
          source: cloudProposals.has(n) ? 'cloud' : 'local',
        });
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
function track(n, { isWatch = false, mode = 'slow', issue = null, source = 'local' } = {}) {
  if (posted.has(n)) return;
  // External normally gives us a 2–3 second head start. Use it to resolve and
  // cache the proposal now, never after Help Wanted has landed.
  void prepareBody(n);
  const existing = tracked.get(n);
  if (existing) {
    if (issue) existing.issue = issue;
    if (mode === 'tight' && existing.mode !== 'tight') upgradeToTight(n, existing);
    return;
  }
  const st = {
    mode,
    isWatch,
    issue,
    source,
    tightUntil: mode === 'tight' ? Date.now() + TIGHT_WINDOW_MS : 0,
  };
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

  // Keep the configured interval start-to-start. Previously we waited for the
  // request AND THEN slept for the full interval, making an advertised 80 ms
  // poll run at (GitHub RTT + 80 ms). We still never overlap requests.
  const tickStartedAt = Date.now();

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
    if (st.source === 'cloud') {
      // Return cloud proposals to the shared repo detector instead of giving
      // every armed row its own permanent polling loop.
      tracked.delete(n);
      log(`#${n} tight window elapsed → back to shared detector`);
      return;
    } else if (st.isWatch) {
      st.mode = 'slow'; // watched issue — drop back to slow and keep waiting
      log(`#${n} tight window elapsed → back to slow watch`);
    } else {
      tracked.delete(n); // discovered candidate that never reached HW — drop it
      log(`⌛ #${n} dropped (no "${TRIGGER_NAME}" within tight window)`);
      return;
    }
  }

  const interval = st.mode === 'tight' ? TIGHT_INTERVAL_MS : DISCOVERY_INTERVAL_MS;
  const elapsed = Date.now() - tickStartedAt;
  setTimeout(() => void tick(n), Math.max(0, interval - elapsed));
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

  const cloudProposal = cloudProposals.get(n);
  if (cloudProposal) {
    try {
      const claimed = await claimCloudProposal(cloudProposal);
      if (!claimed) {
        log(`#${n} skipped — proposal was already claimed or disarmed`);
        return;
      }
    } catch (e) {
      posted.delete(n);
      log(`❌ claim #${n} failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }

  const t0 = Date.now();
  const { status, data } = await gh(`/repos/${REPO}/issues/${n}/comments`, {
    method: 'POST',
    body: { body },
  });
  const dt = Date.now() - t0;

  if (status === 201 && data?.html_url) {
    log(`✅ sniped #${n} via ${via} in ${dt}ms → ${data.html_url}`);
    if (cloudProposal) {
      try {
        await updateCloudProposal(cloudProposal.id, {
          state: 'posted',
          github_comment_id: data.id,
          posted_at: new Date().toISOString(),
          last_error: null,
        });
      } catch (e) {
        log(`⚠️  posted #${n}, but Supabase update failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await notify(`✅ Sniped #${n} in ${dt}ms${title}\nGo edit your proposal:\n${data.html_url}`);
  } else {
    const detail = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
    log(`❌ post #${n} failed: ${status} ${detail}`);
    if (cloudProposal) {
      try {
        await updateCloudProposal(cloudProposal.id, {
          state: 'failed',
          last_error: `${status} ${detail}`.slice(0, 300),
        });
      } catch (e) {
        log(`Supabase failure update failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      posted.delete(n); // local-file mode can retry transient failures
    }
    await notify(`❌ Snipe #${n} failed (HTTP ${status})`);
  }
}

// ── proposal body resolution ──────────────────────────────────────────────────
async function bodyFor(n) {
  return prepareBody(n);
}

function prepareBody(n) {
  const cached = bodies.get(n);
  if (cached) return cached;
  const loading = loadBody(n).catch((error) => {
    bodies.delete(n);
    throw error;
  });
  bodies.set(n, loading);
  return loading;
}

async function loadBody(n) {
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
  const supabaseParts = [SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID].filter(Boolean).length;
  if (supabaseParts > 0 && !CLOUD_MODE) {
    console.error('Supabase mode requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_USER_ID');
    process.exit(1);
  }
  if (!DISCOVER && WATCH.length === 0 && !CLOUD_MODE) {
    console.error('Nothing to do — configure Supabase mode, WATCH=<issue#,...>, and/or DISCOVER=true');
    process.exit(1);
  }
  log(
    `sniper up — repo=${REPO} ` +
      `${DISCOVER ? 'discover=on ' : ''}` +
      `${WATCH.length ? `watch=[${WATCH.join(',')}] ` : ''}` +
      `${CLOUD_MODE ? `supabase=on sync=${ARMED_SYNC_INTERVAL_MS}ms ` : ''}` +
      `dryRun=${DRY_RUN} tight=${TIGHT_INTERVAL_MS}ms`
  );
  if (DISCOVER && !DRY_RUN) {
    log(
      '⚠️  DISCOVER + live posting: only run this if you genuinely intend to ' +
        'follow up every snipe with a real proposal. Blanket auto-posting is a ban risk.'
    );
  }

  for (const n of WATCH) track(n, { isWatch: true, mode: 'slow' });
  if (DISCOVER || CLOUD_MODE) void discoverTick();
  if (CLOUD_MODE) void cloudSyncTick();
}

main();
