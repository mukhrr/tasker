import { getSupabaseClient, resetClient } from './supabase';
import { SUPABASE_URL, APP_URL } from '../env';
import type {
  MessageRequest,
  MessageResponse,
  SessionData,
  IssueLabelsEtagData,
} from '../shared/messages';
import type { Task, UserStatus, Proposal } from '../shared/types';
import { handleTestTelegram } from './telegram';
import {
  handleSendHelpWantedNotification,
  handleTestBrowserNotification,
  handleTestNotification,
  registerBrowserNotificationClicks,
} from './notifier';
import { registerAlarmListener, scheduleAlarm } from './poller';

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
    case 'POST_PROPOSAL_NOW':
      return handlePostProposalNow(msg.proposalId, msg.force === true);
    case 'QUERY_ISSUE_LABELS_ETAG':
      return handleQueryIssueLabelsEtag(msg.owner, msg.repo, msg.number, msg.etag);
    case 'GET_AUTOPOST':
      return handleGetAutoPost();
    case 'SET_AUTOPOST':
      return handleSetAutoPost(msg.enabled);
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

async function handleUpdateStatus(taskId: string, status: string, statusGroup: string): Promise<MessageResponse> {
  if (!taskId || typeof taskId !== 'string') return { ok: false, error: 'Invalid task ID' };
  if (!status || typeof status !== 'string') return { ok: false, error: 'Invalid status' };
  const validGroups = ['todo', 'in_progress', 'complete'];
  if (!validGroups.includes(statusGroup)) return { ok: false, error: 'Invalid status group' };

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('tasks')
    .update({ status, status_group: statusGroup })
    .eq('id', taskId)
    .eq('user_id', session.session.user.id);

  if (error) return { ok: false, error: error.message };
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

  const { error } = await supabase
    .from('tasks')
    .update({ status, status_group: statusGroup })
    .eq('user_id', session.session.user.id)
    .ilike('repo_owner', owner)
    .ilike('repo_name', repo)
    .in('issue_number', issueNumbers);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: session.session.user.id,
      issue_url: safeIssueUrl,
      status: 'in_proposal',
      status_group: 'todo',
      repo_owner: owner,
      repo_name: repo,
      issue_number: number,
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

  // Pull the GitHub provider token from the active Supabase session if present
  // so we get the 5,000/hr authenticated quota instead of 60/hr per-IP unauth.
  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const providerToken = sessionData.session?.provider_token ?? null;

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

  if (existing && (existing.state === 'posting' || existing.state === 'posted')) {
    return { ok: false, error: `Proposal already ${existing.state}` };
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
  if (existing.state === 'posting' || existing.state === 'posted') {
    return { ok: false, error: `Proposal already ${existing.state}` };
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

// ── Tab-side fast-path: claim and post directly using the user's
// session.provider_token, instead of waiting for the cloud worker. ──

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

  // Mirror to user_settings so the cloud worker honors it too. Best-effort —
  // the local toggle still gates the tab-side fast path even if this fails.
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

async function handleQueryIssueLabelsEtag(
  owner: string,
  repo: string,
  number: number,
  etag: string | null,
): Promise<MessageResponse<IssueLabelsEtagData>> {
  const validationErr = validateRepoTuple(owner, repo, number);
  if (validationErr) return { ok: false, error: validationErr };

  const supabase = getSupabaseClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const providerToken = sessionData.session?.provider_token ?? null;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (providerToken) headers.Authorization = `Bearer ${providerToken}`;
  if (etag) headers['If-None-Match'] = etag;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/labels`,
      { headers },
    );

    if (res.status === 304) {
      return { ok: true, data: { etag, labels: null, notModified: true } };
    }
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const detail = remaining === '0' ? ' (rate limit exhausted)' : '';
      return { ok: false, error: `GitHub ${res.status}${detail}` };
    }

    const newEtag = res.headers.get('etag');
    const data = (await res.json()) as Array<{ name?: string } | string>;
    const labels = data
      .map((l) => (typeof l === 'string' ? l : l?.name ?? ''))
      .filter((n): n is string => !!n);
    return { ok: true, data: { etag: newEtag, labels, notModified: false } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

async function handlePostProposalNow(proposalId: string, force = false): Promise<MessageResponse<Proposal>> {
  if (!proposalId || typeof proposalId !== 'string') {
    return { ok: false, error: 'Invalid proposal id' };
  }
  // Auto-post kill switch only gates the *automatic* fast path. A manual
  // "Post now" click is explicit user intent — let it through.
  if (!force && !(await isAutoPostAllowedLocally())) {
    return { ok: false, error: 'Auto-post is disabled' };
  }

  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user) return { ok: false, error: 'Not authenticated' };
  const userId = session.session.user.id;
  const providerToken = session.session.provider_token;
  if (!providerToken) {
    return { ok: false, error: 'No GitHub provider token; sign out and back in with public_repo scope.' };
  }

  // Atomic claim. Auto path: armed → posting only. Forced path: any
  // non-terminal state → posting (draft, armed, or failed). Two parallel
  // callers (mutation observer + ETag poll, or two tabs) collapse here;
  // the loser gets claimed=null.
  const allowedFromStates = force ? ['draft', 'armed', 'failed'] : ['armed'];
  const { data: claimed, error: claimErr } = await supabase
    .from('proposals')
    .update({ state: 'posting' })
    .eq('id', proposalId)
    .eq('user_id', userId)
    .in('state', allowedFromStates)
    .select()
    .maybeSingle();

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
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(proposal.repo_owner)}/${encodeURIComponent(proposal.repo_name)}/issues/${proposal.issue_number}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${providerToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: proposal.body }),
      },
    );

    if (res.status !== 201) {
      const text = await res.text().catch(() => '');
      const errMsg = `${res.status} ${text.slice(0, 200)}`;
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
    return { ok: true, data: posted as Proposal };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Network error';
    await supabase
      .from('proposals')
      .update({ state: 'failed', last_error: errMsg })
      .eq('id', proposal.id);
    return { ok: false, error: errMsg };
  }
}
