import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runSync } from '@/lib/agent/runner';
import { decrypt } from '@/lib/encryption';
import { friendlySyncError } from '@/lib/sync-errors';

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

  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!settings?.ai_api_key_encrypted || !settings?.github_token_encrypted) {
    return NextResponse.json(
      { error: 'Missing API key or GitHub token' },
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

  try {
    const apiKey = decrypt(settings.ai_api_key_encrypted);
    const githubToken = settings.github_token_encrypted;
    const result = await runSync(
      user.id,
      { apiKey, githubToken, githubUsername },
      taskId
    );

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
