import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const jwt = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;

  if (!jwt) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(jwt);

  if (userErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const providerToken = body?.provider_token;
  if (typeof providerToken !== 'string' || !providerToken) {
    return NextResponse.json(
      { error: 'provider_token required' },
      { status: 400 }
    );
  }

  const encrypted = encrypt(providerToken);

  const { error: upsertErr } = await supabase
    .from('user_settings')
    .upsert(
      { id: user.id, github_token_encrypted: encrypted },
      { onConflict: 'id' }
    );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
