import { createClient } from '@supabase/supabase-js';
import { createSyncGraph } from './graph';
import { decrypt } from '@/lib/encryption';
import type { Task, UserStatus } from '@/types/database';

interface SyncCredentials {
  apiKey: string;
  githubToken: string;
  githubUsername: string;
}

export async function runSync(
  userId: string,
  credentials?: SyncCredentials,
  taskId?: string
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  let apiKey: string;
  let githubToken: string;
  let githubUsername: string;

  if (credentials) {
    apiKey = credentials.apiKey;
    githubToken = credentials.githubToken;
    githubUsername = credentials.githubUsername;
  } else {
    // Fallback for cron route (uses service role key to bypass RLS)
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

    apiKey = decrypt(settings.ai_api_key_encrypted);
    githubToken = settings.github_token_encrypted;

    // Get github_username from settings or profile
    githubUsername = settings.github_username || '';
    if (!githubUsername) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('github_username')
        .eq('id', userId)
        .single();
      githubUsername = profile?.github_username || '';
    }

    if (!githubUsername) {
      throw new Error(
        'No GitHub username configured. Go to Settings to add one.'
      );
    }
  }

  // Get tasks that need syncing
  let query = supabase.from('tasks').select('*').eq('user_id', userId);

  if (taskId) {
    query = query.eq('id', taskId);
  } else {
    query = query.not('status', 'in', '("paid","wasted")');
  }

  const { data: tasks } = await query;

  if (!tasks || tasks.length === 0) {
    return { tasks_updated: 0, errors: [] };
  }

  // Fetch user's custom statuses for the AI prompt
  const { data: userStatuses } = await supabase
    .from('user_statuses')
    .select('*')
    .eq('user_id', userId)
    .order('group_name')
    .order('position');

  // Seed defaults if user has no statuses yet
  if (!userStatuses || userStatuses.length === 0) {
    await supabase.rpc('seed_default_statuses', { p_user_id: userId });
  }

  const { data: finalStatuses } =
    userStatuses && userStatuses.length > 0
      ? { data: userStatuses }
      : await supabase
          .from('user_statuses')
          .select('*')
          .eq('user_id', userId)
          .order('group_name')
          .order('position');

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
      githubUsername,
      userStatuses: (finalStatuses as UserStatus[]) ?? [],
      currentIndex: 0,
      updates: [],
      errors: [],
    });

    let tasksUpdated = 0;

    // Apply updates
    for (const update of result.updates) {
      if (update.confidence >= 0.6) {
        const currentTask = tasks.find((t) => t.id === update.taskId);
        if (!currentTask) continue;

        const updateData: Record<string, unknown> = {
          ai_summary: update.summary,
          last_synced_at: new Date().toISOString(),
        };

        // Skip AI status override if user manually edited since last sync
        const wasManuallyEdited =
          currentTask.last_synced_at &&
          new Date(currentTask.updated_at) >
            new Date(currentTask.last_synced_at);

        // Status change at high confidence
        if (
          update.suggestedStatus !== currentTask.status &&
          update.confidence >= 0.75 &&
          !wasManuallyEdited
        ) {
          updateData.status = update.suggestedStatus;
          // Derive status_group from user's statuses
          const matchedStatus = (finalStatuses as UserStatus[])?.find(
            (s) => s.key === update.suggestedStatus
          );
          if (matchedStatus) {
            updateData.status_group = matchedStatus.group_name;
          }
        }

        // Rich fields — only update if AI provided a value (non-null)
        if (update.issue_title !== undefined && update.issue_title !== null) {
          updateData.issue_title = update.issue_title;
        }

        if (update.pr_url !== undefined && update.pr_url !== null) {
          updateData.pr_url = update.pr_url;
        }

        if (
          update.assigned_date !== undefined &&
          update.assigned_date !== null
        ) {
          updateData.assigned_date = update.assigned_date;
        }

        if (update.payment_date !== undefined && update.payment_date !== null) {
          updateData.payment_date = update.payment_date;
        }

        if (update.amount !== undefined && update.amount !== null) {
          // Only set amount if not already set by user
          if (!currentTask.amount) {
            updateData.amount = update.amount;
          }
        }

        // Regression: halve the amount
        const effectiveStatus =
          (updateData.status as string) ?? currentTask.status;
        if (effectiveStatus === 'regression' && currentTask.amount) {
          updateData.amount = Number(currentTask.amount) * 0.5;
        }

        await supabase.from('tasks').update(updateData).eq('id', update.taskId);

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
          bounties_updated: tasksUpdated,
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
