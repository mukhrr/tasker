import { getSupabaseClient, resetClient } from './supabase';
import { SUPABASE_URL } from '../env';
import type { MessageRequest, MessageResponse, SessionData } from '../shared/messages';
import type { Task, UserStatus } from '../shared/types';

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
  // Build the Supabase OAuth URL pointing to GitHub
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
  // Supabase returns: redirect_url#access_token=...&refresh_token=...&...
  const hashParams = new URLSearchParams(responseUrl.split('#')[1] ?? '');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

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

  return {
    ok: true,
    data: { userId: data.user.id, email: data.user.email ?? '' },
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
