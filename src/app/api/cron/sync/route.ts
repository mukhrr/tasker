import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runSync } from '@/lib/agent/runner';
import { isSyncDue } from '@/lib/agent/schedule';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // CLI-backend users are scheduled by the syncer worker, not this cron.
  const { data: users } = await supabase
    .from('user_settings')
    .select('id, sync_interval_hours')
    .eq('auto_sync_enabled', true)
    .eq('ai_backend', 'api');

  if (!users || users.length === 0) {
    return NextResponse.json({ message: 'No users to sync' });
  }

  const results: { userId: string; status: string; error?: string }[] = [];

  for (const user of users) {
    // Check if enough time has passed since last sync
    const { data: lastSync } = await supabase
      .from('sync_logs')
      .select('started_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!isSyncDue(lastSync?.started_at, user.sync_interval_hours)) {
      results.push({ userId: user.id, status: 'skipped' });
      continue;
    }

    try {
      await runSync(user.id);
      results.push({ userId: user.id, status: 'completed' });
    } catch (err) {
      results.push({
        userId: user.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ results });
}
