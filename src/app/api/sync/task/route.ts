import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runSync } from '@/lib/agent/runner';
import { anthropicAnalyzer } from '@/lib/agent/llm';
import {
  enqueueSync,
  isCliBackend,
  NOT_READY_MESSAGE,
  syncReady,
} from '@/lib/agent/backend';
import { decrypt, decryptIfEncrypted } from '@/lib/encryption';
import { friendlySyncError } from '@/lib/sync-errors';
import type { UserSettings } from '@/types/database';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { taskId } = await request.json();
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const { data } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user.id)
    .single();
  const settings = data as UserSettings | null;
  const backend = settings?.ai_backend ?? 'api';

  if (!syncReady(settings)) {
    return NextResponse.json(
      { error: NOT_READY_MESSAGE[backend] },
      { status: 400 }
    );
  }

  if (!settings?.github_token_encrypted) {
    return NextResponse.json(
      { error: 'No GitHub token. Please reconnect with GitHub OAuth.' },
      { status: 400 }
    );
  }

  const githubUsername =
    settings.github_username ||
    (user.user_metadata?.user_name as string | undefined) ||
    '';

  if (!githubUsername) {
    return NextResponse.json(
      { error: 'No GitHub username configured' },
      { status: 400 }
    );
  }

  if (isCliBackend(backend)) {
    const queued = await enqueueSync(supabase, user.id, backend, taskId);
    if (!queued.ok) {
      return NextResponse.json(
        { error: queued.error },
        { status: queued.status }
      );
    }
    return NextResponse.json(
      { queued: true, syncLogId: queued.syncLogId },
      { status: 202 }
    );
  }

  try {
    const result = await runSync(user.id, {
      analyzer: anthropicAnalyzer(decrypt(settings.ai_api_key_encrypted!)),
      credentials: {
        githubToken: decryptIfEncrypted(settings.github_token_encrypted),
        githubUsername,
      },
      taskId,
    });

    if (result.errors?.length && result.tasks_updated === 0) {
      return NextResponse.json(
        { error: friendlySyncError(result.errors[0]), details: result.errors },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json(
      { error: friendlySyncError(message) },
      { status: 500 }
    );
  }
}
