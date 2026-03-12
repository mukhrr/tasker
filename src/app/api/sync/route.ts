import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runSync } from '@/lib/agent/runner';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const result = await runSync(user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
