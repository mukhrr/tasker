import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';

// CORS for the chrome extension. We respond to preflights and add the
// allow-origin echo on the actual POST so chrome-extension://… origins
// can call this route directly.
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed =
    origin.startsWith('chrome-extension://') ||
    origin === 'https://www.taskerr.it.com' ||
    origin === 'https://taskerr.it.com';
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const cors = corsHeaders(request);
  const authHeader = request.headers.get('authorization');
  const jwt = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;

  if (!jwt) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401, headers: cors });
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
    return NextResponse.json({ error: 'Invalid session' }, { status: 401, headers: cors });
  }

  const body = await request.json().catch(() => null);
  const providerToken = body?.provider_token;
  if (typeof providerToken !== 'string' || !providerToken) {
    return NextResponse.json(
      { error: 'provider_token required' },
      { status: 400, headers: cors }
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
    return NextResponse.json({ error: upsertErr.message }, { status: 500, headers: cors });
  }

  return NextResponse.json({ ok: true }, { headers: cors });
}
