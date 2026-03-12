import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/bounties';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      // Store GitHub provider token (Supabase doesn't persist it after exchange)
      const providerToken = data.session.provider_token;
      if (providerToken) {
        const userId = data.session.user.id;
        // Store token in user_settings for sync usage
        await supabase.from('user_settings').upsert(
          { id: userId, github_token_encrypted: providerToken },
          { onConflict: 'id' }
        );
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=Could not authenticate`);
}
