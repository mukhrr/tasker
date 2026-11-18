import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sessionUser } from '@/lib/supabase/session-user';

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await sessionUser(supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ?id= lets the toolbar poll the exact row it queued.
  const id = new URL(request.url).searchParams.get('id');
  let query = supabase.from('sync_logs').select('*').eq('user_id', user.id);
  query = id
    ? query.eq('id', id)
    : query.order('started_at', { ascending: false }).limit(1);
  const { data: syncLog } = await query.maybeSingle();

  return NextResponse.json(syncLog ?? null, {
    headers: {
      'Cache-Control': 'private, max-age=30',
    },
  });
}
