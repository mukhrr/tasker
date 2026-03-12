import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/tasks';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      const userId = data.session.user.id;
      const userMeta = data.session.user.user_metadata;
      const githubUsername = userMeta?.user_name as string | undefined;
      const providerToken = data.session.provider_token;

      // Upsert user_settings with GitHub username and optional provider token
      const upsertData: Record<string, unknown> = { id: userId };
      if (githubUsername) upsertData.github_username = githubUsername;
      if (providerToken) upsertData.github_token_encrypted = providerToken;

      await supabase.from('user_settings').upsert(upsertData, { onConflict: 'id' });

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=Could not authenticate`);
}
