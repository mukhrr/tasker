import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/encryption';

const GITHUB_API = 'https://api.github.com';
const READY_LABEL = 'Help Wanted';

interface ArmedProposal {
  id: string;
  user_id: string;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  body: string;
}

interface IssueEvent {
  event: string;
  label?: { name?: string } | null;
  issue?: { number?: number } | null;
}

interface PollSummary {
  repos: number;
  matches: number;
  posted: number;
  failed: number;
}

export async function runPollCycle(
  supabase: SupabaseClient
): Promise<PollSummary> {
  const summary: PollSummary = {
    repos: 0,
    matches: 0,
    posted: 0,
    failed: 0,
  };

  const { data: armed, error } = await supabase
    .from('proposals')
    .select('id, user_id, repo_owner, repo_name, issue_number, body')
    .eq('state', 'armed');

  if (error) throw new Error(`load armed proposals: ${error.message}`);
  if (!armed || armed.length === 0) return summary;

  // Honor the per-user kill switch. Users with proposal_auto_post=false stay
  // armed (their drafts persist) but the worker won't post on their behalf.
  const userIds = Array.from(new Set((armed as ArmedProposal[]).map((p) => p.user_id)));
  const { data: settingsRows } = await supabase
    .from('user_settings')
    .select('id, proposal_auto_post')
    .in('id', userIds);
  const optedOut = new Set(
    (settingsRows ?? [])
      .filter((r: { proposal_auto_post?: boolean | null }) => r.proposal_auto_post === false)
      .map((r: { id: string }) => r.id)
  );
  const eligible = (armed as ArmedProposal[]).filter((p) => !optedOut.has(p.user_id));
  if (eligible.length === 0) return summary;

  const byRepo = new Map<string, ArmedProposal[]>();
  for (const p of eligible) {
    const key = `${p.repo_owner}/${p.repo_name}`;
    const list = byRepo.get(key);
    if (list) list.push(p);
    else byRepo.set(key, [p]);
  }

  summary.repos = byRepo.size;

  for (const [, proposals] of byRepo) {
    const { repo_owner, repo_name } = proposals[0];
    const matches = await pollRepo(supabase, repo_owner, repo_name, proposals);
    summary.matches += matches.length;
    for (const proposal of matches) {
      const ok = await claimAndPost(supabase, proposal);
      if (ok) summary.posted++;
      else summary.failed++;
    }
  }

  return summary;
}

async function pollRepo(
  supabase: SupabaseClient,
  owner: string,
  repo: string,
  proposals: ArmedProposal[]
): Promise<ArmedProposal[]> {
  const { data: cursor } = await supabase
    .from('repo_poll_state')
    .select('etag')
    .eq('repo_owner', owner)
    .eq('repo_name', repo)
    .maybeSingle();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (cursor?.etag) headers['If-None-Match'] = cursor.etag;

  const token = await loadAnyToken(supabase, proposals);
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/events?per_page=100`,
    { headers }
  );

  if (res.status === 304) return [];
  if (!res.ok) {
    console.warn(`[proposals] events fetch ${owner}/${repo} → ${res.status}`);
    return [];
  }

  const newEtag = res.headers.get('etag');
  if (newEtag) {
    await supabase.from('repo_poll_state').upsert(
      {
        repo_owner: owner,
        repo_name: repo,
        etag: newEtag,
        last_polled_at: new Date().toISOString(),
      },
      { onConflict: 'repo_owner,repo_name' }
    );
  }

  const events = (await res.json()) as IssueEvent[];
  const armedByIssue = new Map<number, ArmedProposal[]>();
  for (const p of proposals) {
    const list = armedByIssue.get(p.issue_number);
    if (list) list.push(p);
    else armedByIssue.set(p.issue_number, [p]);
  }

  const matches: ArmedProposal[] = [];
  for (const ev of events) {
    if (ev.event !== 'labeled') continue;
    if (ev.label?.name?.toLowerCase() !== READY_LABEL.toLowerCase()) continue;
    const num = ev.issue?.number;
    if (!num) continue;
    const list = armedByIssue.get(num);
    if (list) matches.push(...list);
  }

  return matches;
}

async function loadAnyToken(
  supabase: SupabaseClient,
  proposals: ArmedProposal[]
): Promise<string | null> {
  for (const p of proposals) {
    const token = await loadUserToken(supabase, p.user_id);
    if (token) return token;
  }
  return null;
}

async function loadUserToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('user_settings')
    .select('github_token_encrypted')
    .eq('id', userId)
    .single();
  if (!data?.github_token_encrypted) return null;
  try {
    return decrypt(data.github_token_encrypted);
  } catch (e) {
    console.warn(`[proposals] decrypt failed for user ${userId}`, e);
    return null;
  }
}

async function claimAndPost(
  supabase: SupabaseClient,
  proposal: ArmedProposal
): Promise<boolean> {
  const { data: claimed, error: claimErr } = await supabase
    .from('proposals')
    .update({ state: 'posting' })
    .eq('id', proposal.id)
    .eq('state', 'armed')
    .select()
    .maybeSingle();

  if (claimErr) {
    console.warn(`[proposals] claim ${proposal.id} failed`, claimErr.message);
    return false;
  }
  if (!claimed) return false;

  const token = await loadUserToken(supabase, proposal.user_id);
  if (!token) {
    await supabase
      .from('proposals')
      .update({
        state: 'failed',
        last_error: 'No GitHub token; reconnect with public_repo scope.',
      })
      .eq('id', proposal.id);
    return false;
  }

  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(proposal.repo_owner)}/${encodeURIComponent(proposal.repo_name)}/issues/${proposal.issue_number}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: proposal.body }),
      }
    );

    if (res.status !== 201) {
      const text = await res.text().catch(() => '');
      await supabase
        .from('proposals')
        .update({
          state: 'failed',
          last_error: `${res.status} ${text.slice(0, 300)}`,
        })
        .eq('id', proposal.id);
      return false;
    }

    const created = (await res.json()) as { id: number };
    await supabase
      .from('proposals')
      .update({
        state: 'posted',
        github_comment_id: created.id,
        posted_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', proposal.id);
    return true;
  } catch (e) {
    await supabase
      .from('proposals')
      .update({
        state: 'failed',
        last_error: e instanceof Error ? e.message : String(e),
      })
      .eq('id', proposal.id);
    return false;
  }
}
