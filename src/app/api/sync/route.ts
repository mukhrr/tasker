import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runSync } from '@/lib/agent/runner';
import { decrypt } from '@/lib/encryption';
import { friendlySyncError } from '@/lib/sync-errors';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch settings with the authenticated client (RLS-safe)
  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!settings?.ai_api_key_encrypted) {
    return NextResponse.json(
      { error: 'No AI API key configured. Go to Settings to add one.' },
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
      { error: 'No GitHub username configured. Go to Settings to add one.' },
      { status: 400 }
    );
  }

  // Check for concurrent sync
  const { data: runningSync } = await supabase
    .from('sync_logs')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'running')
    .single();

  if (runningSync) {
    return NextResponse.json(
      { error: 'A sync is already in progress' },
      { status: 409 }
    );
  }

  try {
    const apiKey = decrypt(settings.ai_api_key_encrypted);
    const githubToken = settings.github_token_encrypted;
    const result = await runSync(user.id, { apiKey, githubToken, githubUsername });

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
