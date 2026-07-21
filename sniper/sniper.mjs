#!/usr/bin/env node
/**
 * Tasker proposal sniper — always-on, server-side.
 *
 * Races the Expensify `Help Wanted` label and posts a pre-staged proposal in
 * the first instant of the second AFTER the label lands — far ahead of a
 * browser tab, which is throttled by Chrome MV3 service-worker cold-starts and
 * only watches one open issue at a time.
 *
 * Strategy (confirmed against real issue timing on Expensify/App):
 *   - Proposals must be posted AFTER the `Help Wanted` label (posting in the
 *     External→Help Wanted gap is not accepted).
 *   - Melvin applies `External` ~2-3s BEFORE `Help Wanted`, so we LOCK onto an
 *     issue the instant it gets `External`, tight-poll its labels at ~50ms, and
 *     FIRE the moment `Help Wanted` appears. Label polls are ETag-conditional,
 *     so the in-window burst is cheap 304s (they still count toward limits).
 *   - GitHub truncates created_at to whole seconds, and a comment created in
 *     the SAME second as `Help Wanted` can render ABOVE the label. After
 *     detection we wait just past the next server-second boundary — and no
 *     longer — using response Date headers as the clock reference.
 *   - Every GitHub request (304s included) counts toward a per-minute budget;
 *     polling degrades gracefully at the cap instead of tripping the secondary
 *     rate limit mid-race.
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
const TIGHT_INTERVAL_MS = int('TIGHT_INTERVAL_MS', 50); // poll once External is seen
const TIGHT_WINDOW_MS = int('TIGHT_WINDOW_MS', 15000); // max time to tight-poll one issue
const FRESH_LOCK_MS = int('FRESH_LOCK_MS', 20000); // only lock issues updated this recently
const FIRE_FRESH_MS = int('FIRE_FRESH_MS', 8000); // catch-up fire only if HW this fresh
const POST_BOUNDARY_MARGIN_MS = int('POST_BOUNDARY_MARGIN_MS', 75); // past the second boundary after HW
const POST_LATENCY_COMP_CAP_MS = int('POST_LATENCY_COMP_CAP_MS', 12); // max send-early compensation; 0 disables
const MAX_POST_DELAY_MS = 1500; // sanity cap on the boundary wait
// Before posting, look up the real Help Wanted event time so a boundary-crossing
// detection doesn't anchor the post a full second late. Bounded so a slow lookup
// falls back to the detection time instead of stalling the fire.
const HW_ANCHOR_TIMEOUT_MS = int('HW_ANCHOR_TIMEOUT_MS', 500);
const REQUEST_BUDGET_PER_MIN = int('REQUEST_BUDGET_PER_MIN', 500); // all GitHub requests, 304s included
const THROTTLED_INTERVAL_MS = int('THROTTLED_INTERVAL_MS', 250); // poll cadence while over budget
const POST_MORTEM_DELAY_MS = int('POST_MORTEM_DELAY_MS', 10000); // 0 disables the race report

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
const TG_API = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
// Telegram-alert every issue that newly gains the trigger label. This is the
// low-latency replacement for the extension's chrome.alarms poller (>=30s).
const ALERT_NEW_TRIGGER = bool('ALERT_NEW_TRIGGER', true);
const ALERT_FRESH_MS = int('ALERT_FRESH_MS', 600000); // ignore label events older than this

// Auto-draft: queue label-matched issues into Supabase for the drafter worker.
// Groups are '+'-joined labels (AND within a group) separated by '|' (OR across
// groups) — the exact semantics the extension uses. Matching runs on the
// discovery page we already fetch, so it costs no extra GitHub requests.
const AUTO_DRAFT = bool('AUTO_DRAFT', false);
// Env-provided defaults. The extension can override these by syncing its own
// watched groups / excluded labels to Supabase (see activeWatchGroups below).
const ENV_WATCH_GROUPS = (process.env.WATCH_GROUPS || '')
  .split('|')
  .map((g) => g.split('+').map((l) => l.trim().toLowerCase()).filter(Boolean))
  .filter((g) => g.length > 0);
const ENV_EXCLUDE_LABELS = new Set(
  (process.env.EXCLUDE_LABELS || '')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);
// Live config used for matching. Replaced by the extension's synced config when
// present in user_settings; otherwise the env defaults above.
let activeWatchGroups = ENV_WATCH_GROUPS;
let activeExcludeLabels = ENV_EXCLUDE_LABELS;
let watchConfigSource = ENV_WATCH_GROUPS.length ? 'env' : 'none';

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
const armedBodyCache = new Map(); // proposal id -> { updatedAt, body }; avoids re-fetching the body every sync
const checkedLabelUpdates = new Map(); // "issue:label" -> issue.updated_at already verified
const fireEventChecks = new Map(); // fire-path memo for the real HW event lookup (kept separate so it never false-negatives)
const consumedLockEvents = new Map(); // issue number -> External event timestamp already raced
const inFlightCloud = new Set(); // issue numbers temporarily claimed as `posting`
const preClaimed = new Set(); // issues whose armed→posting claim already happened at lock time
const preClaimPromises = new Map(); // issue -> in-flight pre-claim; fire() awaits instead of racing it
let lastStaleRecoveryAt = 0;
let backoffUntil = 0;
const requestTimes = []; // GitHub request timestamps within the last 60s (budget window)
let clockLB = null; // { localMs, serverMs } — lower bound on GitHub's clock
let budgetThrottleLoggedAt = 0;
const alerted = new Set(); // issue numbers already Telegram-alerted for the trigger label
const alertEventChecks = new Map(); // alert-path memo — MUST stay separate from checkedLabelUpdates
let alertSeeded = false; // first discovery scan only records existing trigger issues
const queued = new Set(); // issue numbers already enqueued for the drafter this process
let queueSeeded = false; // first discovery scan only records existing matches, never queues them

// ── request budget + GitHub clock tracking ───────────────────────────────────
// Secondary rate limits count 304s too (learned the hard way on #95956), so
// EVERY request is budgeted. Pollers check the budget and degrade instead of
// hammering into a 403.
function pruneRequestTimes(now) {
  while (requestTimes.length && requestTimes[0] <= now - 60_000) requestTimes.shift();
}

// Background discovery yields at 80% of the budget so an in-progress race
// (tight polling) always has reserve headroom; the fire POST is never gated.
function budgetExhausted(fraction = 1) {
  const now = Date.now();
  pruneRequestTimes(now);
  return requestTimes.length >= REQUEST_BUDGET_PER_MIN * fraction;
}

function logBudgetThrottle(what) {
  const now = Date.now();
  if (now - budgetThrottleLoggedAt < 10_000) return;
  budgetThrottleLoggedAt = now;
  log(`🐢 request budget ${REQUEST_BUDGET_PER_MIN}/min reached — ${what} throttled to ${THROTTLED_INTERVAL_MS}ms`);
}

// GitHub's Date header is truncated to whole seconds, so each response yields a
// LOWER bound on the server clock. Keep the tightest one: samples taken right
// after a second rollover (tight polling sees one every second) dominate, which
// pins the boundary phase to within one poll interval.
function noteServerDate(dateHeader) {
  const parsed = Date.parse(dateHeader || '');
  if (!Number.isFinite(parsed)) return NaN;
  const localMs = Date.now();
  const serverMs = Math.floor(parsed / 1000) * 1000;
  if (!clockLB || serverMs >= clockLB.serverMs + (localMs - clockLB.localMs)) {
    clockLB = { localMs, serverMs };
  }
  return parsed;
}

function serverNowLowerBound() {
  return clockLB ? clockLB.serverMs + (Date.now() - clockLB.localMs) : null;
}

// ── latency compensation ─────────────────────────────────────────────────────
// created_at is stamped when the POST ARRIVES at GitHub (send + one-way), so
// waiting until the boundary locally means landing one-way later. Send earlier
// by 40% of the minimum recent round-trip (a hard floor on the network path —
// strictly less than the true one-way, so arrival can never precede the
// boundary). Capped, and disabled with POST_LATENCY_COMP_CAP_MS=0.
const rttSamples = []; // { at, ms } — round-trips to headers-received
function noteRtt(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const now = Date.now();
  rttSamples.push({ at: now, ms });
  while (rttSamples.length && (rttSamples.length > 40 || now - rttSamples[0].at > 120_000)) {
    rttSamples.shift();
  }
}
function latencyCompMs() {
  if (POST_LATENCY_COMP_CAP_MS <= 0 || !rttSamples.length) return 0;
  const minRtt = Math.min(...rttSamples.map((s) => s.ms));
  return Math.max(0, Math.min(POST_LATENCY_COMP_CAP_MS, Math.floor(minRtt * 0.4)));
}

// ── clock calibration burst ──────────────────────────────────────────────────
// The clock lower bound is only as tight as the sampling around a Date-header
// rollover (~one 50ms poll interval). When a race locks on, burst cheap samples
// at /rate_limit — exempt from rate limiting and deliberately NOT counted
// toward the request budget — until a rollover is observed, pinning the phase
// to ~one sample gap + jitter before the fire matters. Lock-time bursts sample
// every 15ms (phase ≤ ~15ms); the always-on background repin (see boot) uses a
// gentler 40ms so its per-minute traffic stays negligible while still keeping
// the phase pinned and the RTT window fresh for races that lock with sub-second
// runway (#96588 locked 300ms after the label — the burst can't finish in time,
// so the fire must be able to rely on an already-pinned clock).
let calibratingClock = false;
let lastCalibrationAt = 0;
async function calibrateClock(reason) {
  if (calibratingClock || Date.now() - lastCalibrationAt < 10_000) return;
  const spacingMs = reason === 'background' ? 40 : 15;
  calibratingClock = true;
  lastCalibrationAt = Date.now();
  try {
    let prevSec = null;
    const deadline = Date.now() + 1_400;
    while (Date.now() < deadline) {
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(`${API}/rate_limit`, {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'tasker-sniper',
          },
        });
      } catch {
        break;
      }
      noteRtt(Date.now() - t0);
      const parsed = noteServerDate(res.headers.get('date'));
      void res.text().catch(() => '');
      const sec = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
      if (prevSec !== null && sec !== null && sec > prevSec) break; // rollover captured — phase pinned
      if (sec !== null) prevSec = sec;
      await new Promise((r) => setTimeout(r, spacingMs));
    }
    // Background repins run every minute — logging each would drown the stream.
    if (reason !== 'background') log(`⏱️  clock calibration burst done (${reason}), comp=${latencyCompMs()}ms`);
  } finally {
    calibratingClock = false;
  }
}

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

// Fetch just the body for one proposal id — used when the armed sync sees a new
// or edited row (the sync itself no longer pulls bodies).
async function fetchProposalBody(id) {
  const q = new URLSearchParams({
    select: 'body',
    id: `eq.${id}`,
    user_id: `eq.${SUPABASE_USER_ID}`,
    limit: '1',
  });
  const rows = await supabaseRequest(`proposals?${q}`);
  return Array.isArray(rows) && typeof rows[0]?.body === 'string' ? rows[0].body.trim() : '';
}

async function syncArmedProposals() {
  const [owner, repo] = REPO.split('/');

  // Self-heal claims orphaned by a crash or redeploy: a `posting` row with no
  // comment id that hasn't moved in >2 minutes can never complete. updated_at
  // is trigger-maintained (005_proposals.sql), so a live pre-claim — at most
  // TIGHT_WINDOW_MS old — is never touched.
  if (Date.now() - lastStaleRecoveryAt > 60_000) {
    lastStaleRecoveryAt = Date.now();
    const recoveryQuery = new URLSearchParams({
      user_id: `eq.${SUPABASE_USER_ID}`,
      state: 'eq.posting',
      github_comment_id: 'is.null',
      updated_at: `lt.${new Date(Date.now() - 120_000).toISOString()}`,
      select: 'issue_number',
    });
    const recovered = await supabaseRequest(`proposals?${recoveryQuery}`, {
      method: 'PATCH',
      body: { state: 'armed', last_error: 'Recovered stale posting claim after a worker restart.' },
      prefer: 'return=representation',
    });
    if (Array.isArray(recovered) && recovered.length > 0) {
      log(`♻️  re-armed ${recovered.length} stale posting claim(s): ${recovered.map((r) => `#${r.issue_number}`).join(', ')}`);
    }
  }

  const settingsQuery = new URLSearchParams({
    select: 'proposal_auto_post,watched_label_groups,excluded_labels',
    id: `eq.${SUPABASE_USER_ID}`,
    limit: '1',
  });
  const settingsRows = await supabaseRequest(`user_settings?${settingsQuery}`);
  const autoPostEnabled = !Array.isArray(settingsRows) || settingsRows[0]?.proposal_auto_post !== false;
  // Follow the extension's watched groups / excluded labels when it has synced
  // them; otherwise stay on the env defaults.
  applyWatchConfig(Array.isArray(settingsRows) ? settingsRows[0] : null);

  const query = new URLSearchParams({
    // No `body` here — it's multi-KB per row and rarely changes. Re-downloading
    // every armed body on this 1s tick was the dominant Supabase egress cost.
    // The body is fetched lazily below only when a row is new or its updated_at
    // (trigger-maintained) changes.
    select: 'id,user_id,repo_owner,repo_name,issue_number,state,updated_at',
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
    if (!Number.isInteger(n) || n <= 0) continue;
    // Fetch the body only when the row is new or its updated_at changed; reuse
    // the cached body otherwise. This keeps 1s arm-detection responsiveness while
    // pulling each body across the wire once per arm/edit, not once per second.
    const cachedBody = armedBodyCache.get(proposal.id);
    let body;
    if (cachedBody && cachedBody.updatedAt === proposal.updated_at) {
      body = cachedBody.body;
    } else {
      body = await fetchProposalBody(proposal.id);
      armedBodyCache.set(proposal.id, { updatedAt: proposal.updated_at, body });
    }
    if (!body) continue;
    proposal.body = body; // downstream (claim, fire) reads it off the cached row

    if (!validatedCloudProposalIds.has(proposal.id)) {
      const retry = cloudValidationBackoff.get(proposal.id);
      if (retry && Date.now() < retry.retryAt) continue;

      const { status, data, error } = await gh(`/repos/${REPO}/issues/${n}`);
      if ([301, 404, 410].includes(status)) {
        cloudValidationBackoff.delete(proposal.id);
        await updateCloudProposal(proposal.id, {
          state: 'draft',
          last_error: 'Auto-disarmed because the GitHub issue was moved, deleted, or is unavailable.',
        });
        log(`🚫 #${n} is moved or unavailable — auto-disarmed`);
        continue;
      }
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
    // Claiming changes the row from armed → posting. Keep its cached body and
    // metadata until fire() finishes; otherwise a fast sync can cancel retry.
    if (inFlightCloud.has(n)) continue;
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
  for (const id of armedBodyCache.keys()) {
    if (!queriedProposalIds.has(id)) armedBodyCache.delete(id);
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

// Claim armed → posting the moment the tight window OPENS. External gives a
// 1-3s head start, and burning the Supabase round-trip there instead of after
// Help Wanted keeps the claim off the hot path entirely (a real race on
// #96332 lost ~460ms to a 674ms claim that outlived the boundary wait).
function preClaimCloudProposal(n) {
  if (DRY_RUN) return Promise.resolve(); // dry runs must never mutate Supabase state
  const existing = preClaimPromises.get(n);
  if (existing) return existing;
  const pending = doPreClaim(n);
  preClaimPromises.set(n, pending);
  return pending;
}

async function doPreClaim(n) {
  const proposal = cloudProposals.get(n);
  if (!proposal || preClaimed.has(n) || inFlightCloud.has(n) || posted.has(n)) return;
  inFlightCloud.add(n);
  try {
    const claimed = await claimCloudProposal(proposal);
    if (claimed) {
      preClaimed.add(n);
      log(`🔏 #${n} pre-claimed for posting`);
    } else {
      inFlightCloud.delete(n);
      log(`#${n} pre-claim skipped — proposal was already claimed or disarmed`);
    }
  } catch (e) {
    // Not fatal: fire() falls back to claiming on the hot path.
    inFlightCloud.delete(n);
    log(`pre-claim #${n} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Hand the claim back when a tight window ends without Help Wanted. The PATCH
// is state-filtered so a manual disarm/draft during the window is never
// overwritten; a failed release self-heals via the stale-claim recovery.
async function releasePreClaim(n) {
  preClaimPromises.delete(n); // allow a later re-lock to pre-claim again
  if (!preClaimed.has(n)) return;
  preClaimed.delete(n);
  const proposal = cloudProposals.get(n);
  try {
    if (proposal) {
      const query = new URLSearchParams({
        id: `eq.${proposal.id}`,
        user_id: `eq.${SUPABASE_USER_ID}`,
        state: 'eq.posting',
      });
      await supabaseRequest(`proposals?${query}`, {
        method: 'PATCH',
        body: { state: 'armed', last_error: null },
        prefer: 'return=minimal',
      });
      log(`🔓 #${n} pre-claim released`);
    }
  } catch (e) {
    log(`release pre-claim #${n} failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    inFlightCloud.delete(n);
  }
}

// ── auto-draft: queue label-matched issues for the drafter worker ─────────────
function autoDraftEnabled() {
  return AUTO_DRAFT && CLOUD_MODE && activeWatchGroups.length > 0;
}

// Extension-identical matching: AND within a group, OR across groups, and drop
// the issue if it carries ANY excluded label. Runs against the labels already
// present on the discovery page (no extra request).
function matchesWatchGroups(labelSet) {
  // Draft only in the PRE-Help-Wanted window. An issue that already carries
  // Help Wanted or External is past the point where a pre-armed draft helps the
  // race — the sniper's job there is to post, not to start drafting. (The manual
  // "Run Auto-pilot" button bypasses this and can still draft such issues.)
  if (labelSet.has(TRIGGER) || labelSet.has(LOCK)) return false;
  if (activeExcludeLabels.size && [...labelSet].some((l) => activeExcludeLabels.has(l))) return false;
  return activeWatchGroups.some((group) => group.every((label) => labelSet.has(label)));
}

// Adopt the extension's synced watch config from a user_settings row, falling
// back to the env defaults when it hasn't synced anything. Called each settings
// fetch so edits in the extension take effect within ~1 poll.
function applyWatchConfig(row) {
  const rawGroups = row?.watched_label_groups;
  const rawExcluded = row?.excluded_labels;
  if (Array.isArray(rawGroups) && rawGroups.length > 0) {
    const groups = rawGroups
      .map((g) => (Array.isArray(g) ? g.map((l) => String(l).trim().toLowerCase()).filter(Boolean) : []))
      .filter((g) => g.length > 0);
    if (groups.length > 0) {
      const excluded = new Set(
        (Array.isArray(rawExcluded) ? rawExcluded : []).map((l) => String(l).trim().toLowerCase()).filter(Boolean),
      );
      const changed =
        watchConfigSource !== 'extension' ||
        JSON.stringify(groups) !== JSON.stringify(activeWatchGroups) ||
        JSON.stringify([...excluded]) !== JSON.stringify([...activeExcludeLabels]);
      activeWatchGroups = groups;
      activeExcludeLabels = excluded;
      watchConfigSource = 'extension';
      if (changed) {
        queued.clear(); // re-evaluate the page against the new rules
        queueSeeded = false;
        log(`🧩 watch config from extension — groups=[${groups.map((g) => g.join('+')).join('|')}] excl=[${[...excluded].join(',')}]`);
      }
      return;
    }
  }
  // No synced config — revert to env defaults if we had adopted the extension's.
  if (watchConfigSource === 'extension') {
    activeWatchGroups = ENV_WATCH_GROUPS;
    activeExcludeLabels = ENV_EXCLUDE_LABELS;
    watchConfigSource = ENV_WATCH_GROUPS.length ? 'env' : 'none';
    queued.clear();
    queueSeeded = false;
    log('🧩 watch config reverted to env defaults (extension synced none)');
  }
}

async function enqueueForDrafting(issue) {
  const n = issue.number;
  if (queued.has(n)) return;
  queued.add(n); // optimistic; a failed insert clears it below for a later retry
  const [owner, repo] = REPO.split('/');
  const title = issue.title ? ` — ${issue.title}` : '';
  try {
    // ignore-duplicates + on_conflict makes this idempotent against the unique
    // (user_id, repo_owner, repo_name, issue_number) constraint — a manual row
    // or a prior queue entry is never overwritten. (Without on_conflict,
    // PostgREST still 409s — learned from the #93306 retry spam.)
    const rows = await supabaseRequest('proposals?on_conflict=user_id,repo_owner,repo_name,issue_number', {
      method: 'POST',
      body: {
        user_id: SUPABASE_USER_ID,
        repo_owner: owner,
        repo_name: repo,
        issue_number: n,
        state: 'queued',
        origin: 'auto',
      },
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
    const inserted = Array.isArray(rows) && rows.length > 0;
    if (inserted) {
      log(`🧠 #${n} queued for drafting${title}`);
      await notify(`🧠 Queued for drafting ${REPO}#${n}${title}\nhttps://github.com/${REPO}/issues/${n}`, { level: 'verbose' });
    } else {
      log(`#${n} already has a proposal row — not re-queued`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/duplicate key|23505|409/.test(msg)) {
      // Already has a row — terminal, keep it marked so we never retry.
      log(`#${n} already has a proposal row — not re-queued`);
    } else {
      queued.delete(n); // transient failure: allow a later scan to retry
      log(`enqueue #${n} failed: ${msg}`);
    }
  }
}

// ── GitHub fetch (conditional + rate-limit aware) ─────────────────────────────
async function gh(p, { method = 'GET', body, useEtag = false, key } = {}) {
  if (Date.now() < backoffUntil) {
    return { status: 429, data: null, rateLimited: true, retryAt: backoffUntil };
  }
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

  const startedAt = Date.now();
  requestTimes.push(startedAt);
  pruneRequestTimes(startedAt);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // GitHub occasionally returns a 301 with an empty Location for removed
      // issues. Inspect it instead of letting fetch turn it into a network error.
      redirect: 'manual',
    });
  } catch (e) {
    return { status: 0, data: null, error: e.message };
  }
  noteRtt(Date.now() - startedAt);

  if (useEtag) {
    const et = res.headers.get('etag');
    if (et) etags.set(k, et);
  }
  const dateMs = noteServerDate(res.headers.get('date'));
  const link = res.headers.get('link');

  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  const message = typeof data === 'string' ? data : data?.message || '';
  const retryAfterHeader = res.headers.get('retry-after');
  const remaining = res.headers.get('x-ratelimit-remaining');
  const isRateLimited =
    res.status === 429 ||
    (res.status === 403 && (
      retryAfterHeader !== null ||
      remaining === '0' ||
      /rate limit|abuse detection|temporarily blocked/i.test(message)
    ));
  if (isRateLimited) {
    const retryAfter = parseInt(retryAfterHeader || '', 10);
    const reset = parseInt(res.headers.get('x-ratelimit-reset') || '', 10);
    let waitMs = 60000;
    if (!Number.isNaN(retryAfter)) waitMs = retryAfter * 1000;
    else if (res.headers.get('x-ratelimit-remaining') === '0' && reset) {
      waitMs = Math.max(1000, reset * 1000 - Date.now());
    }
    backoffUntil = Date.now() + waitMs;
    log(`⏸️  rate-limited (${res.status}) — backing off ${Math.round(waitMs / 1000)}s`);
    return {
      status: res.status,
      data,
      rateLimited: true,
      retryAt: backoffUntil,
      dateMs,
    };
  }
  if (res.status === 304) return { status: 304, data: null, dateMs };
  return { status: res.status, data, dateMs, link };
}

// ── discovery: inspect the repository's most recently updated open issues ────
async function discoverTick() {
  if (budgetExhausted(0.8)) {
    logBudgetThrottle('discovery');
    setTimeout(discoverTick, Math.max(DISCOVERY_INTERVAL_MS, THROTTLED_INTERVAL_MS));
    return;
  }
  const q =
    `/repos/${REPO}/issues?state=open&sort=updated&direction=desc&per_page=50`;
  const { status, data } = await gh(q, { useEtag: true, key: 'discover' });
  if (status === 200 && Array.isArray(data)) {
    const alertCandidates = [];
    const queueCandidates = [];
    for (const issue of data) {
      if (issue.pull_request) continue; // the issues endpoint also returns PRs
      const n = issue.number;
      const issueLabels = labelNames(issue.labels);

      // Collect trigger-label alert candidates for EVERY issue (armed or not)
      // without awaiting — verification happens after the loop so alerting can
      // never delay a lock or a fire. Armed issues are excluded: they get the
      // snipe notification instead, and their label-event memo must never be
      // consumed by the alert path.
      if (alertingEnabled() && issueLabels.includes(TRIGGER) && !cloudProposals.has(n)) {
        if (!alertSeeded) alerted.add(n);
        else if (!alerted.has(n)) alertCandidates.push(issue);
      }

      // Queue label-matched issues for the drafter. Seed on the first scan so a
      // fresh worker doesn't enqueue the entire existing page; enqueue only
      // matches seen after that. Idempotent at the DB layer, so this set is just
      // an in-process fast path.
      if (autoDraftEnabled() && matchesWatchGroups(new Set(issueLabels)) && !cloudProposals.has(n)) {
        if (!queueSeeded) queued.add(n);
        else if (!queued.has(n)) queueCandidates.push(issue);
      }

      // Cloud mode is deliberately selective: the shared recent-issue detector
      // ignores everything except proposals explicitly armed in the extension.
      if (!DISCOVER && !cloudProposals.has(n)) continue;
      if (posted.has(n) || tracked.has(n)) continue;
      const names = issueLabels;
      const hasLock = names.includes(LOCK);
      const hasHW = names.includes(TRIGGER);
      const updatedAgo = Date.now() - Date.parse(issue.updated_at);
      if (hasLock && !hasHW && updatedAgo < FRESH_LOCK_MS) {
        const proposal = cloudProposals.get(n);
        const armedAt = proposal ? Date.parse(proposal.updated_at || '') : 0;
        const after = Math.max(
          Number.isFinite(armedAt) ? armedAt : 0,
          Date.now() - FRESH_LOCK_MS,
        );
        const lockEventAt = await getRecentLabelEvent(
          n,
          LOCK,
          after,
          issue.updated_at,
        );
        if (lockEventAt && lockEventAt > (consumedLockEvents.get(n) || 0)) {
          // Consume this exact External event once. Comments and other issue
          // updates cannot restart another expensive tight window.
          consumedLockEvents.set(n, lockEventAt);
          track(n, {
            mode: 'tight',
            issue,
            isWatch: cloudProposals.has(n),
            source: cloudProposals.has(n) ? 'cloud' : 'local',
          });
        }
      } else if (hasHW && updatedAgo < FIRE_FRESH_MS) {
        // `updated_at` also changes for unrelated activity. Confirm the actual
        // Help Wanted labeled event is newer than both startup and arm time.
        const proposal = cloudProposals.get(n);
        const armedAt = proposal ? Date.parse(proposal.updated_at || '') : START;
        const after = Number.isFinite(armedAt) ? armedAt : START;
        const hwEventMs = await getRecentLabelEvent(n, TRIGGER, after, issue.updated_at);
        if (hwEventMs) {
          void fire(n, issue, 'direct-hw-event', { hwEventMs });
        }
      }
    }
    alertSeeded = true;
    queueSeeded = true;
    if (alertCandidates.length) void alertNewTriggerIssues(alertCandidates);
    if (queueCandidates.length) void enqueueCandidates(queueCandidates);
  }
  setTimeout(discoverTick, DISCOVERY_INTERVAL_MS);
}

async function enqueueCandidates(issues) {
  for (const issue of issues) await enqueueForDrafting(issue);
}

// ── instant Telegram alert for issues that newly gain the trigger label ───────
function alertingEnabled() {
  return ALERT_NEW_TRIGGER && Boolean(TG_TOKEN && TG_CHAT);
}

async function alertNewTriggerIssues(issues) {
  for (const issue of issues) {
    const n = issue.number;
    if (alerted.has(n)) continue;
    // `updated_at` also changes for unrelated activity (comments bump old
    // trigger-labeled issues back into the recent page). Only alert when the
    // label event itself is fresh — using the alert-path memo, never the fire
    // path's, so this check can't swallow a pending direct-HW fire.
    const eventAt = await getRecentLabelEvent(
      n,
      TRIGGER,
      Date.now() - ALERT_FRESH_MS,
      issue.updated_at,
      alertEventChecks,
    );
    if (!eventAt) continue;
    alerted.add(n);
    const title = issue.title ? ` — ${issue.title}` : '';
    log(`🔔 new "${TRIGGER_NAME}" issue #${n}${title}`);
    void notify(
      `🆕 "${TRIGGER_NAME}" on ${REPO}#${n}${title}\n` +
        `https://github.com/${REPO}/issues/${n}`,
      { level: 'verbose' },
    );
  }
}

async function getRecentLabelEvent(n, label, after, issueUpdatedAt, memo = checkedLabelUpdates) {
  const checkKey = `${n}:${label}`;
  if (memo.get(checkKey) === issueUpdatedAt) return null;
  memo.set(checkKey, issueUpdatedAt);
  const { status, data } = await gh(`/repos/${REPO}/issues/${n}/events?per_page=30`);
  if (status !== 200 || !Array.isArray(data)) {
    memo.delete(checkKey); // transient failure: allow a later retry
    return null;
  }
  let latest = null;
  for (const event of data) {
    if (event?.event !== 'labeled') continue;
    if (event?.label?.name?.toLowerCase() !== label) continue;
    const createdAt = Date.parse(event.created_at || '');
    if (Number.isFinite(createdAt) && createdAt >= after && (latest === null || createdAt > latest)) {
      latest = createdAt;
    }
  }
  return latest;
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
  if (mode === 'tight') void calibrateClock('lock');
  if (mode === 'tight' && source === 'cloud') void preClaimCloudProposal(n);
  void tick(n);
}

function upgradeToTight(n, st) {
  st.mode = 'tight';
  st.tightUntil = Date.now() + TIGHT_WINDOW_MS;
  log(`⚡ #${n} "${LOCK_NAME}" seen → tight-polling for "${TRIGGER_NAME}"`);
  if (st.source === 'cloud') void preClaimCloudProposal(n);
  void calibrateClock('tight'); // pin the second boundary before the fire matters
}

async function tick(n) {
  let st = tracked.get(n);
  if (!st || posted.has(n)) return;

  // Keep the configured interval start-to-start. Previously we waited for the
  // request AND THEN slept for the full interval, making an advertised 80 ms
  // poll run at (GitHub RTT + 80 ms). We still never overlap requests.
  const tickStartedAt = Date.now();

  if (budgetExhausted()) {
    // Skip this poll rather than spend into a secondary-rate-limit 403; the
    // fire POST itself is never budget-gated.
    logBudgetThrottle(`#${n} label poll`);
    if (!survivesTightExpiry(n, st)) return;
    setTimeout(() => void tick(n), THROTTLED_INTERVAL_MS);
    return;
  }

  const { status, data, dateMs } = await gh(`/repos/${REPO}/issues/${n}/labels`, {
    useEtag: true,
    key: `labels-${n}`,
  });

  st = tracked.get(n);
  if (!st || posted.has(n)) return;

  if (status === 200 && Array.isArray(data)) {
    const names = labelNames(data);
    if (names.includes(TRIGGER)) {
      void fire(n, st.issue, st.mode === 'tight' ? 'tight-poll' : 'slow-poll', {
        detectDateMs: dateMs,
        detectLocalMs: Date.now(),
      });
      return;
    }
    if (names.includes(LOCK) && st.mode !== 'tight') upgradeToTight(n, st);
  }

  if (!survivesTightExpiry(n, st)) return;

  const interval = st.mode === 'tight' ? TIGHT_INTERVAL_MS : DISCOVERY_INTERVAL_MS;
  const elapsed = Date.now() - tickStartedAt;
  setTimeout(() => void tick(n), Math.max(0, interval - elapsed));
}

function survivesTightExpiry(n, st) {
  if (st.mode !== 'tight' || Date.now() <= st.tightUntil) return true;
  if (st.source === 'cloud') {
    // Return cloud proposals to the shared repo detector instead of giving
    // every armed row its own permanent polling loop.
    tracked.delete(n);
    void releasePreClaim(n);
    log(`#${n} tight window elapsed → back to shared detector`);
    return false;
  }
  if (st.isWatch) {
    st.mode = 'slow'; // watched issue — drop back to slow and keep waiting
    log(`#${n} tight window elapsed → back to slow watch`);
    return true;
  }
  tracked.delete(n); // discovered candidate that never reached HW — drop it
  log(`⌛ #${n} dropped (no "${TRIGGER_NAME}" within tight window)`);
  return false;
}

// ── fire: post the staged proposal ────────────────────────────────────────────
// The comment must be CREATED in a later GitHub second than the Help Wanted
// event: created_at is truncated to whole seconds, and a same-second comment
// can render above the label (looks posted-before-HW to a reviewer). Wait
// exactly until the boundary after the HW second plus a small margin — firing
// immediately when that boundary has already passed.
function computePostDelay(ctx) {
  // Send earlier by (a hard under-estimate of) the one-way network latency:
  // the comment is stamped on ARRIVAL, so arrival ≈ send + one-way still lands
  // past the boundary. See latencyCompMs.
  const compMs = latencyCompMs();
  if (!ctx) return { delayMs: 0, compMs };
  const hwMs = Number.isFinite(ctx.hwEventMs) ? ctx.hwEventMs : ctx.detectDateMs;
  if (Number.isFinite(hwMs)) {
    const target = (Math.floor(hwMs / 1000) + 1) * 1000 + POST_BOUNDARY_MARGIN_MS - compMs;
    const serverNow = serverNowLowerBound();
    if (serverNow !== null) return { delayMs: clamp(target - serverNow, 0, MAX_POST_DELAY_MS), compMs };
  }
  // No usable server clock sample — conservatively sleep one full second past
  // the local detection time.
  const base = Number.isFinite(ctx.detectLocalMs) ? ctx.detectLocalMs : Date.now();
  return { delayMs: clamp(base + 1000 + POST_BOUNDARY_MARGIN_MS - compMs - Date.now(), 0, MAX_POST_DELAY_MS), compMs };
}

async function fire(n, issue, via, ctx) {
  if (posted.has(n)) return;
  const fireStartedAt = performance.now();
  posted.add(n);
  tracked.delete(n);

  const body = await bodyFor(n);
  const title = issue?.title ? ` — ${issue.title}` : '';
  const issueUrl = `https://github.com/${REPO}/issues/${n}`;

  // Anchor the boundary on the ACTUAL Help Wanted event time. The tight/slow poll
  // paths pass only detectDateMs — the whole second we *saw* the label — so a
  // detection that crossed a server-second boundary targets a full second late
  // (issue #96380: HW at :55, detected at :56, posted at :57). Look up the real
  // labeled-event time now; it overlaps the boundary wait in the common case and
  // rescues the boundary-crossing case. Falls back to detectDateMs if the lookup
  // is missing or slower than HW_ANCHOR_TIMEOUT_MS, so it's never worse than before.
  if (!Number.isFinite(ctx?.hwEventMs)) {
    const evAt = await Promise.race([
      getRecentLabelEvent(n, TRIGGER, START, issue?.updated_at, fireEventChecks).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), HW_ANCHOR_TIMEOUT_MS)),
    ]);
    if (Number.isFinite(evAt)) {
      const detectSec = Number.isFinite(ctx?.detectDateMs) ? Math.floor(ctx.detectDateMs / 1000) * 1000 : null;
      if (detectSec !== null && evAt < detectSec) {
        log(`⏱️  #${n} re-anchored to real HW event ${new Date(evAt).toISOString()} (${detectSec - evAt}ms before our detected second)`);
      }
      ctx = { ...ctx, hwEventMs: evAt };
    }
  }

  const { delayMs, compMs } = computePostDelay(ctx);

  if (DRY_RUN) {
    log(
      `🧪 DRY_RUN: would wait ${delayMs}ms (comp=${compMs}ms) for the second boundary, then POST proposal to #${n} ` +
        `(via ${via}, ${body.length} chars)${title}`,
    );
    await notify(`🧪 [dry-run] would snipe #${n}${title}\n${issueUrl}`);
    return;
  }

  // The boundary wait and the atomic Supabase claim run concurrently — a slow
  // claim no longer pushes the POST past the target boundary.
  const waitPromise =
    delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();

  const cloudProposal = cloudProposals.get(n);
  // If Help Wanted lands while the lock-time pre-claim is still in flight,
  // wait for it (the boundary-wait timer is already running) rather than
  // racing it with a live claim that would see `posting` and skip the snipe.
  const pendingPreClaim = preClaimPromises.get(n);
  if (pendingPreClaim) {
    await pendingPreClaim;
    preClaimPromises.delete(n);
  }
  let claimMs = 0;
  let claimLabel = 'none';
  if (cloudProposal && preClaimed.has(n)) {
    // Claimed back when the tight window opened — nothing left on the hot path.
    preClaimed.delete(n);
    claimLabel = 'pre';
    await waitPromise;
  } else if (cloudProposal) {
    inFlightCloud.add(n);
    let claimed;
    try {
      const claimStartedAt = performance.now();
      const claimPromise = claimCloudProposal(cloudProposal).then((row) => {
        claimMs = performance.now() - claimStartedAt;
        return row;
      });
      [claimed] = await Promise.all([claimPromise, waitPromise]);
    } catch (e) {
      inFlightCloud.delete(n);
      posted.delete(n);
      log(`❌ claim #${n} failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!claimed) {
      inFlightCloud.delete(n);
      log(`#${n} skipped — proposal was already claimed or disarmed`);
      return;
    }
    claimLabel = `${claimMs.toFixed(1)}ms`;
  } else {
    await waitPromise;
  }

  const postStartedAt = performance.now();
  const { status, data, rateLimited, retryAt } = await gh(`/repos/${REPO}/issues/${n}/comments`, {
    method: 'POST',
    body: { body },
  });
  const postMs = performance.now() - postStartedAt;
  const hotPathMs = performance.now() - fireStartedAt;

  if (status === 201 && data?.html_url) {
    // Calibration: which second did GitHub stamp the comment in, relative to
    // the target (the second after Help Wanted)? 0s = perfect, -1s = same
    // second as the label (renders above it — raise the margin), +1s = a full
    // second late (lower the margin or chase the claim/post latency).
    const hwGuessMs = ctx
      ? Number.isFinite(ctx.hwEventMs) ? ctx.hwEventMs : ctx.detectDateMs
      : NaN;
    const stampMs = Date.parse(data.created_at || '');
    let stampInfo = '';
    if (Number.isFinite(hwGuessMs) && Number.isFinite(stampMs)) {
      const deltaS = (stampMs - (Math.floor(hwGuessMs / 1000) + 1) * 1000) / 1000;
      stampInfo = ` stamp=${deltaS >= 0 ? '+' : ''}${deltaS}s-vs-target`;
    }
    log(
        `✅ sniped #${n} via ${via} → ${data.html_url} ` +
        `[claim=${claimLabel} wait=${delayMs}ms comp=${compMs}ms post=${postMs.toFixed(1)}ms hotPath=${hotPathMs.toFixed(1)}ms${stampInfo}]`,
    );
    if (POST_MORTEM_DELAY_MS > 0) {
      setTimeout(() => void racePostMortem(n, data.id), POST_MORTEM_DELAY_MS);
    }
    // The Telegram ping races the Supabase bookkeeping instead of waiting
    // behind it — the user rushing in to edit the placeholder gets the URL
    // one round-trip sooner.
    const notified = notify(
      `✅ Sniped #${n} in ${hotPathMs.toFixed(0)}ms ` +
        `(claim ${claimLabel} / post ${postMs.toFixed(0)}ms)${title}\n` +
        `Go edit your proposal:\n${data.html_url}`,
    );
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
      } finally {
        inFlightCloud.delete(n);
      }
    }
    await notified;
  } else {
    const detail = typeof data === 'string'
      ? data.slice(0, 200)
      : JSON.stringify(data ?? null).slice(0, 200);
    log(`❌ post #${n} failed: ${status} ${detail}`);
    if (cloudProposal && rateLimited) {
      const retryDelayMs = Math.max(1000, (retryAt || Date.now() + 60_000) - Date.now() + 1000);
      try {
        await updateCloudProposal(cloudProposal.id, {
          state: 'armed',
          last_error: `GitHub rate-limited posting (${status}); retry scheduled.`,
        });
      } catch (e) {
        log(`Supabase retry update failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        inFlightCloud.delete(n);
      }
      posted.delete(n);
      log(`↻ #${n} returned to armed; retrying post in ${Math.round(retryDelayMs / 1000)}s`);
      setTimeout(() => {
        // A manual post, disarm, or kill-switch removes it from this map and
        // cancels the retry, preventing duplicate comments.
        if (cloudProposals.has(n) && !posted.has(n)) {
          void fire(n, issue, 'rate-limit-retry');
        }
      }, retryDelayMs);
      await notify(`⏸️ #${n} rate-limited; automatic retry scheduled`, { level: 'verbose' });
      return;
    }
    if (cloudProposal) {
      try {
        await updateCloudProposal(cloudProposal.id, {
          state: 'failed',
          last_error: `${status} ${detail}`.slice(0, 300),
        });
      } catch (e) {
        log(`Supabase failure update failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        inFlightCloud.delete(n);
      }
    } else {
      posted.delete(n); // local-file mode can retry transient failures
    }
    await notify(`❌ Snipe #${n} failed (HTTP ${status})`);
  }
}

// ── post-snipe race report ────────────────────────────────────────────────────
// Runs well off the hot path. Answers the two questions fixed buffers can't:
// did the comment land in a later second than Help Wanted (guaranteed to render
// below the label), and how many rivals posted between the label and us?
function parseLinkHeader(link) {
  const rels = {};
  for (const part of (link || '').split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) rels[m[2]] = m[1];
  }
  return rels;
}

async function racePostMortem(n, commentId) {
  try {
    const first = await gh(`/repos/${REPO}/issues/${n}/timeline?per_page=100`);
    if (first.status !== 200 || !Array.isArray(first.data)) {
      log(`🔬 #${n} race report unavailable (timeline HTTP ${first.status})`);
      return;
    }
    // The race happens at the END of the timeline; follow the Link header to
    // the last page, pulling one page back when it is nearly empty.
    let items = first.data;
    const lastUrl = parseLinkHeader(first.link).last;
    if (lastUrl) {
      const last = await gh(lastUrl);
      if (last.status === 200 && Array.isArray(last.data)) {
        items = last.data;
        const prevUrl = parseLinkHeader(last.link).prev;
        if (items.length < 40 && prevUrl) {
          const prev = await gh(prevUrl);
          if (prev.status === 200 && Array.isArray(prev.data)) items = [...prev.data, ...items];
        }
      }
    }

    const hw = items
      .filter((e) => e?.event === 'labeled' && e.label?.name?.toLowerCase() === TRIGGER)
      .at(-1);
    const comments = items.filter((e) => e?.event === 'commented');
    const ours = comments.find((c) => c.id === commentId);
    if (!hw || !ours) {
      log(
        `🔬 #${n} race report: ${hw ? 'own comment' : `"${TRIGGER_NAME}" event`} not within the fetched timeline window`,
      );
      return;
    }

    const hwMs = Date.parse(hw.created_at);
    const ourMs = Date.parse(ours.created_at);
    const postHw = comments.filter((c) => c.id !== commentId && Date.parse(c.created_at) >= hwMs);
    const ahead = postHw.filter((c) => {
      const ms = Date.parse(c.created_at);
      return ms < ourMs || (ms === ourMs && c.id < ours.id);
    });
    const sameSecond = Math.floor(ourMs / 1000) === Math.floor(hwMs / 1000);
    const aheadList = ahead
      .map((c) => `${c.user?.login || '?'} +${Math.round((Date.parse(c.created_at) - hwMs) / 1000)}s`)
      .join(', ');
    const report =
      `🔬 #${n} race: "${TRIGGER_NAME}" @ ${hw.created_at} → own comment +${Math.round((ourMs - hwMs) / 1000)}s, ` +
      `position ${ahead.length + 1}/${postHw.length + 1} post-HW` +
      (sameSecond ? ' ⚠️ same second as the label — may render above it' : '') +
      (ahead.length ? ` — ahead: ${aheadList}` : '');
    log(report);
    await notify(report, { level: 'verbose' }); // still in the Railway logs; Telegram only when TELEGRAM_VERBOSE
  } catch (e) {
    log(`race report #${n} failed: ${e instanceof Error ? e.message : String(e)}`);
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
// Telegram noise control: 'essential' messages (snipes, failures, race reports)
// always send; 'verbose' ones (per-issue queue/HW/rate-limit chatter) send only
// when TELEGRAM_VERBOSE is on.
const TELEGRAM_VERBOSE = bool('TELEGRAM_VERBOSE', false);
async function notify(text, { level = 'essential' } = {}) {
  if (level === 'verbose' && !TELEGRAM_VERBOSE) return;
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const res = await fetch(`${TG_API}/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000), // a hung Telegram call must never wedge a caller
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log(`telegram err: ${res.status} ${body.slice(0, 120)}`);
    }
  } catch (e) {
    log(`telegram err: ${e.message}`);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function labelNames(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
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
  if (process.env.POST_SAFETY_DELAY_MS) {
    log(
      '⚠️  POST_SAFETY_DELAY_MS is no longer used — the worker now waits for the GitHub ' +
        'second boundary after Help Wanted. Tune POST_BOUNDARY_MARGIN_MS instead.',
    );
  }
  log(
    `sniper up — repo=${REPO} ` +
      `${DISCOVER ? 'discover=on ' : ''}` +
      `${WATCH.length ? `watch=[${WATCH.join(',')}] ` : ''}` +
      `${CLOUD_MODE ? `supabase=on sync=${ARMED_SYNC_INTERVAL_MS}ms ` : ''}` +
      `dryRun=${DRY_RUN} tight=${TIGHT_INTERVAL_MS}ms margin=${POST_BOUNDARY_MARGIN_MS}ms ` +
      `budget=${REQUEST_BUDGET_PER_MIN}/min telegram=${TG_TOKEN && TG_CHAT ? 'on' : 'off'} ` +
      `alerts=${alertingEnabled() ? 'on' : 'off'} autoDraft=${autoDraftEnabled() ? 'on' : 'off'}`
  );
  if (ALERT_NEW_TRIGGER && !(TG_TOKEN && TG_CHAT)) {
    log(`ℹ️  instant "${TRIGGER_NAME}" alerts are idle — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable`);
  }
  if (AUTO_DRAFT && !autoDraftEnabled()) {
    const why = !CLOUD_MODE ? 'Supabase is not configured' : 'no watched groups yet (env empty; awaiting extension sync)';
    log(`ℹ️  auto-draft is idle — ${why}`);
  } else if (autoDraftEnabled()) {
    log(
      `🧠 auto-draft queueing on (${watchConfigSource}) — ` +
        `groups=[${activeWatchGroups.map((g) => g.join('+')).join('|')}] excl=[${[...activeExcludeLabels].join(',')}]`,
    );
  }
  if (DISCOVER && !DRY_RUN) {
    log(
      '⚠️  DISCOVER + live posting: only run this if you genuinely intend to ' +
        'follow up every snipe with a real proposal. Blanket auto-posting is a ban risk.'
    );
  }

  // Keep the boundary phase pinned and the RTT window fresh at all times, so a
  // race that locks with sub-second runway (HW seen first via discovery) fires
  // off an already-calibrated clock instead of a half-finished burst, and
  // latency comp never decays to 0 because the 120s RTT window went quiet.
  setInterval(() => void calibrateClock('background'), 60_000);

  for (const n of WATCH) track(n, { isWatch: true, mode: 'slow' });
  if (DISCOVER || CLOUD_MODE) void discoverTick();
  if (CLOUD_MODE) void cloudSyncTick();
}

main();
