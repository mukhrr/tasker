import { getSupabaseClient, resetClient } from './supabase';
import { SUPABASE_URL, APP_URL } from '../env';
import type {
  MessageRequest,
  MessageResponse,
  SessionData,
} from '../shared/messages';
import type { Task, UserStatus } from '../shared/types';

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
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function handleGithubLogin(): Promise<MessageResponse<SessionData>> {
  // Build the Supabase OAuth URL pointing to GitHub.
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set('provider', 'github');
  authUrl.searchParams.set('redirect_to', redirectUrl);

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

    // Also persist it to user_settings so the web app's sync can read GitHub as this user.
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
    // A comment link on the same issue is its own row; prefer the oldest row here.
    .order('created_at', { ascending: true })
    .limit(1)
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
  const validGroups = ['todo', 'in_progress', 'pending', 'complete'];
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

  const validGroups = ['todo', 'in_progress', 'pending', 'complete'];
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
