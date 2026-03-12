import { createClient } from '@supabase/supabase-js';
import { createSyncGraph } from './graph';
import { decrypt } from '@/lib/encryption';
import type { Task } from '@/types/database';

export async function runSync(userId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Get user settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', userId)
    .single();

  if (!settings?.ai_api_key_encrypted) {
    throw new Error('No AI API key configured. Go to Settings to add one.');
  }

  if (!settings?.github_token_encrypted) {
    throw new Error('No GitHub token. Please reconnect with GitHub OAuth.');
  }

  const apiKey = decrypt(settings.ai_api_key_encrypted);
  const githubToken = settings.github_token_encrypted; // stored as plaintext from OAuth for now

  // Get tasks that need syncing
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .not('status', 'in', '("paid","wasted")');

  if (!tasks || tasks.length === 0) {
    return { tasks_updated: 0, errors: [] };
  }

  // Create sync log
  const { data: syncLog } = await supabase
    .from('sync_logs')
    .insert({ user_id: userId, status: 'running' })
    .select()
    .single();

  try {
    const graph = createSyncGraph();

    const result = await graph.invoke({
      tasks: tasks as Task[],
      githubToken,
      apiKey,
      currentIndex: 0,
      updates: [],
      errors: [],
    });

    let tasksUpdated = 0;

    // Apply updates
    for (const update of result.updates) {
      if (update.confidence >= 0.6) {
        const updateData: Record<string, unknown> = {
          ai_summary: update.summary,
          last_synced_at: new Date().toISOString(),
        };

        // Only update status if confidence is high enough and status changed
        const currentTask = tasks.find((t) => t.id === update.taskId);
        if (currentTask && update.suggestedStatus !== currentTask.status && update.confidence >= 0.75) {
          updateData.status = update.suggestedStatus;
        }

        await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', update.taskId);

        tasksUpdated++;
      }
    }

    // Update sync log
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          bounties_updated: tasksUpdated, // DB column name
          details: { updates: result.updates, errors: result.errors },
        })
        .eq('id', syncLog.id);
    }

    return { tasks_updated: tasksUpdated, errors: result.errors };
  } catch (err) {
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', syncLog.id);
    }
    throw err;
  }
}
