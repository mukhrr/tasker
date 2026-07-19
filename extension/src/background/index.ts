import { getSupabaseClient, resetClient } from './supabase';
import { SUPABASE_URL, APP_URL } from '../env';
import type {
  MessageRequest,
  MessageResponse,
  SessionData,
} from '../shared/messages';
import type { Task, UserStatus, Proposal, ProposalState, AnalysisRequest } from '../shared/types';
import { SERVER_OWNED_STATES } from '../shared/types';
import { handleTestTelegram } from './telegram';
import {
  handleSendHelpWantedNotification,
  handleTestBrowserNotification,
  handleTestNotification,
  registerBrowserNotificationClicks,
} from './notifier';
import { registerAlarmListener, scheduleAlarm } from './poller';

// Supabase JS only exposes session.provider_token immediately after the
// OAuth callback. After the first auto-refresh (~1h) it's gone, so we
// cache it ourselves to survive across refreshes. Cleared on logout.
const GITHUB_PROVIDER_TOKEN_KEY = 'githubProviderToken';

async function getGithubProviderToken(): Promise<string | null> {
  // Prefer the freshly-issued session token (right after OAuth) — it'll
  // match the cached one anyway. Fall back to the cache after refreshes.
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const sessionToken = data.session?.provider_token;
  if (sessionToken) return sessionToken;
  const cached = await chrome.storage.local.get(GITHUB_PROVIDER_TOKEN_KEY);
  return (cached[GITHUB_PROVIDER_TOKEN_KEY] as string | undefined) ?? null;
}

chrome.runtime.onMessage.addListener((message: MessageRequest, sender, sendResponse) => {
  // Only accept messages from our own extension (popup + content scripts)
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Unauthorized sender' });
    return true;
  }

  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err?.message ?? 'Unknown error' });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg: MessageRequest): Promise<MessageResponse> {
  switch (msg.type) {
    case 'LOGIN_GITHUB':
      return handleGithubLogin();
    case 'LOGOUT':
      return handleLogout();
    case 'GET_SESSION':
      return handleGetSession();
    case 'QUERY_TASK':
      return handleQueryTask(msg.owner, msg.repo, msg.number);
    case 'QUERY_STATUSES':
      return handleQueryStatuses();
    case 'UPDATE_STATUS':
      return handleUpdateStatus(msg.taskId, msg.status, msg.statusGroup);
    case 'CREATE_TASK':
      return handleCreateTask(msg.owner, msg.repo, msg.number);
    case 'QUERY_TASKS_BATCH':
      return handleQueryTasksBatch(msg.owner, msg.repo, msg.issueNumbers);
    case 'UPDATE_LINKED_STATUSES':
      return handleUpdateLinkedStatuses(msg.owner, msg.repo, msg.issueNumbers, msg.status, msg.statusGroup);
    case 'SEND_HELP_WANTED':
      return handleSendHelpWantedNotification(msg.owner, msg.repo, msg.number, msg.title, msg.url, msg.labels);
    case 'TEST_TELEGRAM':
      return handleTestTelegram(msg.token, msg.chatId);
    case 'TEST_BROWSER_NOTIFICATION':
      return handleTestBrowserNotification();
    case 'TEST_NOTIFICATION':
      return handleTestNotification();
    case 'RESCHEDULE_POLLER':
      await scheduleAlarm();
      return { ok: true };
    case 'QUERY_ISSUE_LABELS':
      return handleQueryIssueLabels(msg.owner, msg.repo, msg.number);
    case 'QUERY_PROPOSAL':
      return handleQueryProposal(msg.owner, msg.repo, msg.number);
    case 'SAVE_PROPOSAL':
      return handleSaveProposal(msg.owner, msg.repo, msg.number, msg.body);
    case 'ARM_PROPOSAL':
      return handleSetProposalState(msg.owner, msg.repo, msg.number, 'armed');
    case 'DISARM_PROPOSAL':
      return handleSetProposalState(msg.owner, msg.repo, msg.number, 'draft');
    case 'ENQUEUE_AUTO_DRAFT':
      return handleEnqueueAutoDraft(msg.owner, msg.repo, msg.number);
    case 'CANCEL_AUTO_DRAFT':
      return handleCancelAutoDraft(msg.owner, msg.repo, msg.number);
    case 'CLEAR_PROPOSAL':
      return handleClearProposal(msg.owner, msg.repo, msg.number);
    case 'RUN_ANALYSIS':
      return handleRunAnalysis(msg.owner, msg.repo, msg.number);
    case 'QUERY_ANALYSIS':
      return handleQueryAnalysis(msg.owner, msg.repo, msg.number);
    case 'CANCEL_ANALYSIS':
      return handleCancelAnalysis(msg.owner, msg.repo, msg.number);
    case 'SYNC_LABEL_CONFIG':
      return handleSyncLabelConfig(msg.watchedLabelGroups, msg.excludedLabels);
    case 'POST_PROPOSAL_NOW':
      return handlePostProposalNow(msg.proposalId, msg.force === true);
    case 'GET_AUTOPOST':
      return handleGetAutoPost();
    case 'SET_AUTOPOST':
      return handleSetAutoPost(msg.enabled);
    case 'GET_AUTOPILOT':
      return handleGetAutoPilot();
    case 'SET_AUTOPILOT':
      return handleSetAutoPilot(msg.enabled);
    case 'VERIFY_POSTED_COMMENT':
      return handleVerifyPostedComment(msg.proposalId);
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

registerAlarmListener();
registerBrowserNotificationClicks();
chrome.runtime.onInstalled.addListener(() => { void scheduleAlarm(); });
chrome.runtime.onStartup.addListener(() => { void scheduleAlarm(); });
void scheduleAlarm();

async function handleGithubLogin(): Promise<MessageResponse<SessionData>> {
  // Build the Supabase OAuth URL pointing to GitHub.
  // public_repo is required so the server can post issue comments on the user's behalf.
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set('provider', 'github');
  authUrl.searchParams.set('redirect_to', redirectUrl);
  authUrl.searchParams.set('scopes', 'public_repo');

  // Open the OAuth flow in a browser popup
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    return { ok: false, error: 'Login cancelled' };
  }

  // Extract tokens from the redirect URL fragment
  // Supabase returns: redirect_url#access_token=...&refresh_token=...&provider_token=...
  const hashParams = new URLSearchParams(responseUrl.split('#')[1] ?? '');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const providerToken = hashParams.get('provider_token');

  if (!accessToken || !refreshToken) {
    return { ok: false, error: 'No tokens received from GitHub' };
  }

  // Set the session in the Supabase client
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) return { ok: false, error: error.message };
  if (!data.user) return { ok: false, error: 'No user returned' };

  if (providerToken) {
    // Cache the GitHub token locally — supabase-js drops session.provider_token
    // after the first auto-refresh (~1h), so we can't rely on it for long.
    // chrome.storage.local is sandboxed per-extension; the token is the user's
    // own OAuth token and can be revoked from GitHub settings any time.
    await chrome.storage.local.set({ [GITHUB_PROVIDER_TOKEN_KEY]: providerToken });

    // Also persist (encrypted) to user_settings so the cloud poll worker can
    // post on this user's behalf when their tabs are closed.
    try {
      const res = await fetch(`${APP_URL}/api/settings/github-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider_token: providerToken }),
      });
      if (!res.ok) {
        console.warn('[tasker] github token persist failed', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.warn('[tasker] github token persist threw', e);
    }
  }

  return {
    ok: true,
    data: {
      userId: data.user.id,
      email: data.user.email ?? '',
      username: (data.user.user_metadata?.user_name ?? data.user.user_metadata?.preferred_username ?? '') as string,
    },
  };
}

async function handleLogout(): Promise<MessageResponse> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: error.message };
  resetClient();
  await chrome.storage.local.remove(GITHUB_PROVIDER_TOKEN_KEY);
  return { ok: true };
}

async function handleGetSession(): Promise<MessageResponse<SessionData | null>> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();

    if (!data.session?.user) {
      return { ok: true, data: null };
    }

    return {
      ok: true,
      data: {
        userId: data.session.user.id,
        email: data.session.user.email ?? '',
        username: (data.session.user.user_metadata?.user_name ?? data.session.user.user_metadata?.preferred_username ?? '') as string,
      },
    };
  } catch {
    return { ok: true, data: null };
  }
}

async function handleQueryTask(owner: string, repo: string, number: number): Promise<MessageResponse<Task | null>> {
  const ghNameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!owner || !repo || !ghNameRegex.test(owner) || !ghNameRegex.test(repo)) {
    return { ok: false, error: 'Invalid owner or repo name' };
  }
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, error: 'Invalid issue number' };
  }

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Task | null };
}

async function handleQueryStatuses(): Promise<MessageResponse<UserStatus[]>> {
  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  // Check cache first
  const cached = await chrome.storage.local.get(['statusesCache', 'statusesCacheTime']);
  const fiveMin = 5 * 60 * 1000;
  const cacheTime = cached.statusesCacheTime as number | undefined;
  if (cached.statusesCache && cacheTime && Date.now() - cacheTime < fiveMin) {
    return { ok: true, data: cached.statusesCache as UserStatus[] };
  }

  const { data, error } = await supabase
    .from('user_statuses')
    .select('*')
    .eq('user_id', session.session.user.id)
    .order('position');

  if (error) return { ok: false, error: error.message };

  const statuses = (data ?? []) as UserStatus[];
  await chrome.storage.local.set({ statusesCache: statuses, statusesCacheTime: Date.now() });
  return { ok: true, data: statuses };
}

// The built-in status key that means "a contributor has been assigned".
const ASSIGNED_STATUS_KEY = 'assigned';

/** Today's date as YYYY-MM-DD (the `assigned_date` column is a `date`). */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function handleUpdateStatus(taskId: string, status: string, statusGroup: string): Promise<MessageResponse> {
  if (!taskId || typeof taskId !== 'string') return { ok: false, error: 'Invalid task ID' };
  if (!status || typeof status !== 'string') return { ok: false, error: 'Invalid status' };
  const validGroups = ['todo', 'in_progress', 'complete'];
  if (!validGroups.includes(statusGroup)) return { ok: false, error: 'Invalid status group' };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };
  const userId = session.session.user.id;

  const { error } = await supabase
    .from('tasks')
    .update({ status, status_group: statusGroup, status_changed_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) return { ok: false, error: error.message };

  // Stamp the assignment date the first time this task moves to "assigned".
  // `.is('assigned_date', null)` keeps an existing date untouched.
  if (status === ASSIGNED_STATUS_KEY) {
    await supabase
      .from('tasks')
      .update({ assigned_date: todayDate() })
      .eq('id', taskId)
      .eq('user_id', userId)
      .is('assigned_date', null);
  }

  return { ok: true };
}

async function handleQueryTasksBatch(owner: string, repo: string, issueNumbers: number[]): Promise<MessageResponse<Task[]>> {
  if (!issueNumbers.length) return { ok: true, data: [] };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .in('issue_number', issueNumbers);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Task[] };
}

async function handleUpdateLinkedStatuses(
  owner: string,
  repo: string,
  issueNumbers: number[],
  status: string,
  statusGroup: string,
): Promise<MessageResponse> {
  if (!issueNumbers.length) return { ok: true };

  const validGroups = ['todo', 'in_progress', 'complete'];
  if (!validGroups.includes(statusGroup)) return { ok: false, error: 'Invalid status group' };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };
  const userId = session.session.user.id;

  const { error } = await supabase
    .from('tasks')
    .update({ status, status_group: statusGroup, status_changed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .in('issue_number', issueNumbers);

  if (error) return { ok: false, error: error.message };

  // Stamp the assignment date on any of these tasks moving to "assigned"
  // for the first time. `.is('assigned_date', null)` skips ones already set.
  if (status === ASSIGNED_STATUS_KEY) {
    await supabase
      .from('tasks')
      .update({ assigned_date: todayDate() })
      .eq('user_id', userId)
      .ilike('repo_owner', owner)
      .ilike('repo_name', repo)
      .in('issue_number', issueNumbers)
      .is('assigned_date', null);
  }

  return { ok: true };
}

interface IssueEnrichment {
  /** GitHub issue title, verbatim (keeps the leading "[$250]" prefix). */
  issueTitle: string | null;
  /** Bounty amount in USD parsed from the title, or null. */
  amount: number | null;
  /** ISO timestamp of the first time this user was assigned on the issue. */
  assignedDate: string | null;
}

const EMPTY_ENRICHMENT: IssueEnrichment = { issueTitle: null, amount: null, assignedDate: null };

// Expensify convention: titles start with "[$250]". Tolerate "[$1,000.00]"
// and a loose "$250" elsewhere in the title as a fallback.
function parseAmountFromTitle(title: string): number | null {
  const match = title.match(/\[\s*\$\s*([\d,]+(?:\.\d+)?)\s*\]/) ?? title.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Walk the issue's event stream (chronological) and return the timestamp of
// the first "assigned" event whose assignee is this user — i.e. when they
// were put on the issue. Pages through up to 5×100 events for busy issues.
async function findFirstAssignmentDate(
  ownerEnc: string,
  repoEnc: string,
  number: number,
  username: string,
  headers: Record<string, string>
): Promise<string | null> {
  const target = username.toLowerCase();
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${ownerEnc}/${repoEnc}/issues/${number}/events?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) return null;
    const events = (await res.json()) as Array<{
      event?: string;
      assignee?: { login?: string };
      created_at?: string;
    }>;
    const hit = events.find(
      (e) => e.event === 'assigned' && e.assignee?.login?.toLowerCase() === target
    );
    if (hit?.created_at) return hit.created_at;
    if (events.length < 100) return null;
  }
  return null;
}

// Best-effort: pull title / amount / assignment date from the GitHub API.
// Any failure (no token, rate limit, network) yields empty fields — task
// creation must never be blocked by enrichment.
async function fetchIssueEnrichment(
  owner: string,
  repo: string,
  number: number,
  username: string
): Promise<IssueEnrichment> {
  try {
    const providerToken = await getGithubProviderToken();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (providerToken) headers.Authorization = `Bearer ${providerToken}`;

    const ownerEnc = encodeURIComponent(owner);
    const repoEnc = encodeURIComponent(repo);

    const issueRes = await fetch(
      `https://api.github.com/repos/${ownerEnc}/${repoEnc}/issues/${number}`,
      { headers }
    );
    if (!issueRes.ok) return EMPTY_ENRICHMENT;
    const issue = (await issueRes.json()) as { title?: string };
    const issueTitle = typeof issue.title === 'string' ? issue.title : null;

    return {
      issueTitle,
      amount: issueTitle ? parseAmountFromTitle(issueTitle) : null,
      assignedDate: username
        ? await findFirstAssignmentDate(ownerEnc, repoEnc, number, username, headers)
        : null,
    };
  } catch {
    return EMPTY_ENRICHMENT;
  }
}

async function handleCreateTask(owner: string, repo: string, number: number): Promise<MessageResponse<Task>> {
  const ghNameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!owner || !repo || !ghNameRegex.test(owner) || !ghNameRegex.test(repo)) {
    return { ok: false, error: 'Invalid owner or repo name' };
  }
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, error: 'Invalid issue/PR number' };
  }
  const safeIssueUrl = `https://github.com/${owner}/${repo}/issues/${number}`;

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const user = session.session.user;
  const username = (user.user_metadata?.user_name ??
    user.user_metadata?.preferred_username ??
    '') as string;

  const enrichment = await fetchIssueEnrichment(owner, repo, number, username);

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: user.id,
      issue_url: safeIssueUrl,
      status: 'in_proposal',
      status_group: 'todo',
      repo_owner: owner,
      repo_name: repo,
      issue_number: number,
      ...(enrichment.issueTitle ? { issue_title: enrichment.issueTitle } : {}),
      ...(enrichment.amount != null ? { amount: enrichment.amount } : {}),
      ...(enrichment.assignedDate ? { assigned_date: enrichment.assignedDate } : {}),
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Task };
}

function validateRepoTuple(owner: string, repo: string, number: number): string | null {
  const ghNameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!owner || !repo || !ghNameRegex.test(owner) || !ghNameRegex.test(repo)) {
    return 'Invalid owner or repo name';
  }
  if (!Number.isInteger(number) || number <= 0) {
    return 'Invalid issue number';
  }
  return null;
}

async function handleQueryIssueLabels(owner: string, repo: string, number: number): Promise<MessageResponse<string[]>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  // Pull the GitHub provider token (from the cache, surviving session refresh)
  // so we get the 5,000/hr authenticated quota instead of 60/hr per-IP unauth.
  const providerToken = await getGithubProviderToken();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (providerToken) headers.Authorization = `Bearer ${providerToken}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/labels`,
      { headers }
    );
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const detail = remaining === '0' ? ' (rate limit exhausted)' : '';
      return { ok: false, error: `GitHub ${res.status}${detail}` };
    }
    const data = (await res.json()) as Array<{ name?: string } | string>;
    const names = data
      .map((l) => (typeof l === 'string' ? l : l?.name ?? ''))
      .filter((n): n is string => !!n);
    return { ok: true, data: names };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

async function handleQueryProposal(owner: string, repo: string, number: number): Promise<MessageResponse<Proposal | null>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Proposal | null };
}

async function handleSaveProposal(owner: string, repo: string, number: number, body: string): Promise<MessageResponse<Proposal>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };
  if (typeof body !== 'string') return { ok: false, error: 'Invalid body' };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  // Don't overwrite the body of a proposal that's already posting/posted —
  // changes after Help Wanted fires are too late and would cause confusion.
  const { data: existing } = await supabase
    .from('proposals')
    .select('id, state')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();

  // Never overwrite a row the server owns: a posting/posted proposal (too late
  // to edit) or an auto-draft still being queued/generated (the drafter is
  // mid-write; a human Save here would clobber its state and body).
  if (existing && SERVER_OWNED_STATES.has(existing.state as ProposalState)) {
    return { ok: false, error: `Proposal is ${existing.state} — not editable here` };
  }

  const { data, error } = await supabase
    .from('proposals')
    .upsert(
      {
        user_id: session.session.user.id,
        repo_owner: owner,
        repo_name: repo,
        issue_number: number,
        body,
        state: existing?.state === 'armed' ? 'armed' : 'draft',
      },
      { onConflict: 'user_id,repo_owner,repo_name,issue_number' }
    )
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Proposal };
}

async function handleSetProposalState(
  owner: string,
  repo: string,
  number: number,
  newState: 'draft' | 'armed',
): Promise<MessageResponse<Proposal>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data: existing, error: readErr } = await supabase
    .from('proposals')
    .select('*')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };
  if (!existing) return { ok: false, error: 'No draft to update' };
  if (newState === 'armed' && !existing.body?.trim()) {
    return { ok: false, error: 'Cannot arm an empty proposal' };
  }
  if (SERVER_OWNED_STATES.has(existing.state as ProposalState)) {
    return { ok: false, error: `Proposal is ${existing.state} — not editable here` };
  }

  if (newState === 'armed') {
    const providerToken = await getGithubProviderToken();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (providerToken) headers.Authorization = `Bearer ${providerToken}`;
    try {
      const issueRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
        { headers },
      );
      if (!issueRes.ok) {
        return { ok: false, error: `Cannot verify issue state (GitHub ${issueRes.status})` };
      }
      const issue = (await issueRes.json()) as { state?: string };
      if (issue.state !== 'open') {
        return { ok: false, error: 'Closed issues cannot be armed for auto-post.' };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Cannot verify issue state' };
    }
  }

  const { data, error } = await supabase
    .from('proposals')
    .update({ state: newState, last_error: null })
    .eq('id', existing.id)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Proposal };
}

// "Run Auto-pilot": hand this issue to the server-side drafter by setting a
// proposals row to state='queued', origin='auto'. Works for any issue, not just
// ones in a watched label group. Refuses if the row is already in flight
// (queued/drafting) or done with (armed/posting/posted).
async function handleEnqueueAutoDraft(
  owner: string,
  repo: string,
  number: number,
): Promise<MessageResponse<Proposal>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data: existing, error: readErr } = await supabase
    .from('proposals')
    .select('id, state')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  if (existing) {
    const s = existing.state as ProposalState;
    if (s === 'queued' || s === 'drafting') {
      return { ok: false, error: 'Auto-pilot is already running for this issue' };
    }
    if (SERVER_OWNED_STATES.has(s)) {
      return { ok: false, error: `Proposal is ${s} — can't auto-pilot` };
    }
  }

  // Reset draft_attempts so a previously-failed row gets a fresh run. The drafter
  // overwrites the body when it arms, so we leave any existing body untouched.
  const { data, error } = await supabase
    .from('proposals')
    .upsert(
      {
        user_id: session.session.user.id,
        repo_owner: owner,
        repo_name: repo,
        issue_number: number,
        state: 'queued',
        origin: 'auto',
        draft_attempts: 0,
        last_error: null,
      },
      { onConflict: 'user_id,repo_owner,repo_name,issue_number' },
    )
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Proposal };
}

// Cancel an in-flight auto-draft. Moves a queued/drafting row to a plain manual
// 'draft' (origin='manual') so the drafter stops and won't re-queue it. The
// drafter's arm is state-filtered on 'drafting', so a cancel mid-generation is
// honored — the finished draft simply isn't armed.
async function handleCancelAutoDraft(
  owner: string,
  repo: string,
  number: number,
): Promise<MessageResponse<Proposal>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data: existing, error: readErr } = await supabase
    .from('proposals')
    .select('id, state')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!existing) return { ok: false, error: 'Nothing to cancel' };
  if (existing.state !== 'queued' && existing.state !== 'drafting') {
    return { ok: false, error: `Proposal is ${existing.state} — nothing to cancel` };
  }

  const { data, error } = await supabase
    .from('proposals')
    .update({ state: 'draft', origin: 'manual', last_error: null })
    .eq('id', existing.id)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Proposal };
}

// Clear a proposal: delete the row entirely so the widget returns to its empty
// "no proposal yet" state. Refused while the server worker owns the row mid-flight
// (drafting/posting) so we don't delete a row out from under an in-progress write;
// the user should Cancel an auto-draft first. Deleting a 'posted' row only removes
// the Tasker record — the GitHub comment itself is untouched.
async function handleClearProposal(
  owner: string,
  repo: string,
  number: number,
): Promise<MessageResponse<void>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data: existing, error: readErr } = await supabase
    .from('proposals')
    .select('id, state')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!existing) return { ok: true }; // already clear — idempotent success

  const s = existing.state as ProposalState;
  if (s === 'drafting' || s === 'posting') {
    return { ok: false, error: `Proposal is ${s} — cancel it first, then clear` };
  }

  const { error } = await supabase.from('proposals').delete().eq('id', existing.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── "Run Claude analysis" — queue for the LOCAL analyzer daemon ─────────────
// The daemon (analyzer/analyzer.mjs on the user's Mac) polls analysis_requests,
// runs Claude Code (subscription auth) against the local App checkout, and
// writes the outcome back. Re-running a done/failed request resets it to queued.
async function handleRunAnalysis(
  owner: string,
  repo: string,
  number: number,
): Promise<MessageResponse<AnalysisRequest>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data: existing, error: readErr } = await supabase
    .from('analysis_requests')
    .select('id, state')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (existing && (existing.state === 'queued' || existing.state === 'running')) {
    return { ok: false, error: `Analysis is already ${existing.state}` };
  }

  const { data, error } = await supabase
    .from('analysis_requests')
    .upsert(
      {
        user_id: session.session.user.id,
        repo_owner: owner,
        repo_name: repo,
        issue_number: number,
        state: 'queued',
        result_summary: null,
        stash_ref: null,
        last_error: null,
      },
      { onConflict: 'user_id,repo_owner,repo_name,issue_number' },
    )
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AnalysisRequest };
}

async function handleCancelAnalysis(
  owner: string,
  repo: string,
  number: number,
): Promise<MessageResponse<AnalysisRequest>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  // Atomic: only a queued/running row can be canceled; the daemon honors the
  // flip mid-run by killing its claude subprocess.
  const { data, error } = await supabase
    .from('analysis_requests')
    .update({ state: 'canceled' })
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .in('state', ['queued', 'running'])
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Nothing to cancel' };
  return { ok: true, data: data as AnalysisRequest };
}

async function handleQueryAnalysis(
  owner: string,
  repo: string,
  number: number,
): Promise<MessageResponse<AnalysisRequest | null>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('analysis_requests')
    .select('*')
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .eq('issue_number', number)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as AnalysisRequest) ?? null };
}

// ── Proposal controls shared by the popup, manual post, and Railway worker ──

const AUTOPOST_KEY = 'proposalAutoPost';

async function isAutoPostAllowedLocally(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTOPOST_KEY);
  // Default true — feature is opt-out, not opt-in.
  return stored[AUTOPOST_KEY] !== false;
}

async function handleGetAutoPost(): Promise<MessageResponse<{ enabled: boolean }>> {
  return { ok: true, data: { enabled: await isAutoPostAllowedLocally() } };
}

async function handleSetAutoPost(enabled: boolean): Promise<MessageResponse<{ enabled: boolean }>> {
  await chrome.storage.local.set({ [AUTOPOST_KEY]: enabled });

  // Mirror to user_settings so the Railway worker honors it too.
  try {
    const supabase = getSupabaseClient();
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (userId) {
      await supabase
        .from('user_settings')
        .upsert({ id: userId, proposal_auto_post: enabled }, { onConflict: 'id' });
    }
  } catch (e) {
    console.warn('[tasker] mirror autopost to server failed', e);
  }

  return { ok: true, data: { enabled } };
}

// ── Auto-pilot toggle: controls the server-side drafter (auto-drafting), separate
// from auto-post (which controls posting). Mirrored to user_settings.autopilot_enabled
// so the Railway drafter honors it. ──
const AUTOPILOT_KEY = 'proposalAutoPilot';

async function isAutoPilotAllowedLocally(): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTOPILOT_KEY);
  return stored[AUTOPILOT_KEY] !== false; // default true
}

async function handleGetAutoPilot(): Promise<MessageResponse<{ enabled: boolean }>> {
  return { ok: true, data: { enabled: await isAutoPilotAllowedLocally() } };
}

async function handleSetAutoPilot(enabled: boolean): Promise<MessageResponse<{ enabled: boolean }>> {
  await chrome.storage.local.set({ [AUTOPILOT_KEY]: enabled });

  try {
    const supabase = getSupabaseClient();
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (userId) {
      await supabase
        .from('user_settings')
        .upsert({ id: userId, autopilot_enabled: enabled }, { onConflict: 'id' });
    }
  } catch (e) {
    console.warn('[tasker] mirror autopilot to server failed', e);
  }

  return { ok: true, data: { enabled } };
}

// Mirror the watched groups / excluded labels to user_settings so the sniper's
// auto-draft queueing follows the extension config (single source of truth).
async function handleSyncLabelConfig(
  watchedLabelGroups: string[][],
  excludedLabels: string[],
): Promise<MessageResponse<void>> {
  if (!Array.isArray(watchedLabelGroups) || !Array.isArray(excludedLabels)) {
    return { ok: false, error: 'Invalid label config' };
  }
  try {
    const supabase = getSupabaseClient();
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (!userId) return { ok: false, error: 'Not authenticated' };
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        { id: userId, watched_label_groups: watchedLabelGroups, excluded_labels: excludedLabels },
        { onConflict: 'id' },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sync failed' };
  }
}

async function handlePostProposalNow(proposalId: string, force = false): Promise<MessageResponse<Proposal>> {
  console.log('[tasker bg] post-now:start', { proposalId, force });
  if (!proposalId || typeof proposalId !== 'string') {
    return { ok: false, error: 'Invalid proposal id' };
  }
  // Railway is the sole automatic posting owner. Only the explicit manual
  // "Post now" flow is accepted by the extension background.
  if (!force) {
    return { ok: false, error: 'Automatic tab-side posting has been retired' };
  }

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };
  const userId = session.session.user.id;
  const providerToken = await getGithubProviderToken();
  console.log('[tasker bg] post-now:token-resolved', { hasToken: !!providerToken, len: providerToken?.length });
  if (!providerToken) {
    return { ok: false, error: 'No GitHub provider token; sign out and back in with public_repo scope.' };
  }

  // Atomic manual claim from any non-terminal editable state.
  const allowedFromStates = ['draft', 'armed', 'failed'];
  const { data: claimed, error: claimErr } = await supabase
    .from('proposals')
    .update({ state: 'posting' })
    .eq('id', proposalId)
    .eq('user_id', userId)
    .in('state', allowedFromStates)
    .select()
    .maybeSingle();

  console.log('[tasker bg] post-now:claim', { claimed: !!claimed, claimErr: claimErr?.message });
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed) {
    // Already claimed elsewhere (cloud worker, sibling tab, …) — surface the
    // current row so the UI can refresh to its terminal state.
    const { data: current } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', proposalId)
      .maybeSingle();
    if (current) return { ok: true, data: current as Proposal };
    return { ok: false, error: 'Proposal not found or not armed' };
  }

  const proposal = claimed as Proposal;

  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(proposal.repo_owner)}/${encodeURIComponent(proposal.repo_name)}/issues/${proposal.issue_number}/comments`;
    console.log('[tasker bg] post-now:posting', { url });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: proposal.body }),
    });
    console.log('[tasker bg] post-now:response', { status: res.status });

    if (res.status !== 201) {
      const text = await res.text().catch(() => '');
      const errMsg = `${res.status} ${text.slice(0, 200)}`;
      console.warn('[tasker bg] post-now:non-201', errMsg);
      await supabase
        .from('proposals')
        .update({ state: 'failed', last_error: errMsg })
        .eq('id', proposal.id);
      return { ok: false, error: errMsg };
    }

    const created = (await res.json()) as { id: number };
    const { data: posted, error: updErr } = await supabase
      .from('proposals')
      .update({
        state: 'posted',
        github_comment_id: created.id,
        posted_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', proposal.id)
      .select()
      .single();

    if (updErr) return { ok: false, error: updErr.message };
    console.log('[tasker bg] post-now:done', { state: (posted as Proposal | null)?.state });
    return { ok: true, data: posted as Proposal };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Network error';
    console.error('[tasker bg] post-now:threw', errMsg);
    await supabase
      .from('proposals')
      .update({ state: 'failed', last_error: errMsg })
      .eq('id', proposal.id);
    return { ok: false, error: errMsg };
  }
}

// Verify that a 'posted' proposal's comment still exists on GitHub. If
// the user deleted it, revert the row to 'draft' so the textarea+body
// reappear and they can edit/repost without creating a duplicate.
async function handleVerifyPostedComment(proposalId: string): Promise<MessageResponse<Proposal>> {
  if (!proposalId || typeof proposalId !== 'string') {
    return { ok: false, error: 'Invalid proposal id' };
  }

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };
  const userId = session.session.user.id;

  const { data: proposal, error: readErr } = await supabase
    .from('proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('user_id', userId)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };
  if (!proposal) return { ok: false, error: 'Proposal not found' };

  // Only meaningful for posted rows with a recorded comment id.
  if (proposal.state !== 'posted' || !proposal.github_comment_id) {
    return { ok: true, data: proposal as Proposal };
  }

  const providerToken = await getGithubProviderToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (providerToken) headers.Authorization = `Bearer ${providerToken}`;

  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(proposal.repo_owner)}/${encodeURIComponent(proposal.repo_name)}/issues/comments/${proposal.github_comment_id}`;
    const res = await fetch(url, { headers });

    if (res.status === 200) {
      // Still alive — no change.
      return { ok: true, data: proposal as Proposal };
    }
    if (res.status === 404) {
      console.log('[tasker bg] verify:comment-deleted, reverting to draft', proposalId);
      const { data: reverted, error: updErr } = await supabase
        .from('proposals')
        .update({
          state: 'draft',
          github_comment_id: null,
          posted_at: null,
          last_error: 'Previously posted comment was deleted on GitHub.',
        })
        .eq('id', proposalId)
        .select()
        .single();
      if (updErr) return { ok: false, error: updErr.message };
      return { ok: true, data: reverted as Proposal };
    }
    // 401/403/5xx — don't make destructive changes on transient errors.
    return { ok: true, data: proposal as Proposal };
  } catch (e) {
    // Network error — leave the row alone.
    console.warn('[tasker bg] verify:fetch failed', e);
    return { ok: true, data: proposal as Proposal };
  }
}
