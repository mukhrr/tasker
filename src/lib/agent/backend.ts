import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiBackend, UserSettings } from '@/types/database';

export const CLI_BACKENDS: AiBackend[] = ['claude_cli', 'codex_cli'];

export function isCliBackend(backend: AiBackend | null | undefined): boolean {
  return backend === 'claude_cli' || backend === 'codex_cli';
}

type CredentialColumns = Pick<
  UserSettings,
  | 'ai_backend'
  | 'ai_api_key_encrypted'
  | 'claude_oauth_token_encrypted'
  | 'codex_auth_encrypted'
>;

// Whether the selected backend has the credential it needs to run a sync.
export function syncReady(s: Partial<CredentialColumns> | null): boolean {
  if (!s) return false;
  switch (s.ai_backend ?? 'api') {
    case 'claude_cli':
      return !!s.claude_oauth_token_encrypted;
    case 'codex_cli':
      return !!s.codex_auth_encrypted;
    default:
      return !!s.ai_api_key_encrypted;
  }
}

export const NOT_READY_MESSAGE: Record<AiBackend, string> = {
  api: 'No AI API key configured. Go to Settings to add one.',
  claude_cli:
    'Claude CLI is not connected. Paste your setup-token in Settings.',
  codex_cli: 'Codex CLI is not connected. Paste your auth.json in Settings.',
};

export type EnqueueResult =
  | { ok: true; syncLogId: string }
  | { ok: false; status: 409 | 500; error: string };

// CLI syncs run on the syncer worker: insert a queued sync_logs row for it to
// claim. One in-flight sync per user, matching the manual-sync 409.
export async function enqueueSync(
  supabase: SupabaseClient,
  userId: string,
  backend: AiBackend,
  taskId?: string
): Promise<EnqueueResult> {
  const { data: inFlight } = await supabase
    .from('sync_logs')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    return { ok: false, status: 409, error: 'A sync is already in progress' };
  }

  const { data, error } = await supabase
    .from('sync_logs')
    .insert({
      user_id: userId,
      status: 'queued',
      backend,
      task_id: taskId ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: error?.message ?? 'Failed to queue sync',
    };
  }
  return { ok: true, syncLogId: data.id };
}
