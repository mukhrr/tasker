import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ?id= reads one queued/running row while the toolbar waits on it;
  // without it, the latest row.
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
