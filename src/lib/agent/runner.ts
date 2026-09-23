import { createClient } from '@supabase/supabase-js';
import { createSyncGraph, type TaskUpdate } from './graph';
import { anthropicAnalyzer, type Analyzer } from './llm';
import { deciderFromEnv, jevModeFromEnv } from './jev';
import type { JevObservation } from './graph';
import { userSetStatus } from './manual';
import { decrypt, decryptIfEncrypted } from '@/lib/encryption';
import type { Task, UserStatus } from '@/types/database';

interface SyncCredentials {
  githubToken: string;
  githubUsername: string;
}

export interface RunSyncOptions {
  // Web routes pass the session's credentials; cron and the syncer worker
  // leave this out and the runner reads them from user_settings.
  credentials?: SyncCredentials;
  analyzer?: Analyzer;
  // A sync_logs row already claimed by the caller (the worker's queue).
  syncLogId?: string;
  taskId?: string;
  // Set when the worker re-queues a run its container was killed during:
  // tasks synced since this time were already done by the first attempt.
  resumeAfter?: string;
}

export async function runSync(userId: string, opts: RunSyncOptions = {}) {
  const { credentials, syncLogId, taskId, resumeAfter } = opts;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  let analyze = opts.analyzer;
  let githubToken: string;
  let githubUsername: string;

  const needsSettings = !credentials || !analyze;
  const { data: settings } = needsSettings
    ? await supabase.from('user_settings').select('*').eq('id', userId).single()
    : { data: null };

  if (!analyze) {
    if (!settings?.ai_api_key_encrypted) {
      throw new Error('No AI API key configured. Go to Settings to add one.');
    }
    analyze = anthropicAnalyzer(decrypt(settings.ai_api_key_encrypted));
  }

  if (credentials) {
    githubToken = credentials.githubToken;
    githubUsername = credentials.githubUsername;
  } else {
    if (!settings?.github_token_encrypted) {
      throw new Error('No GitHub token. Please reconnect with GitHub OAuth.');
    }

    githubToken = decryptIfEncrypted(settings.github_token_encrypted);

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
    // Archived rows are the user's "done with this"; never spend a model
    // call on them or move their status.
    query = query
      .not('status', 'in', '("paid","wasted")')
      .eq('archived', false);
  }

  if (resumeAfter && !taskId) {
    query = query.or(`last_synced_at.is.null,last_synced_at.lt.${resumeAfter}`);
  }

  const { data: tasks, error: tasksError } = await query;
  if (tasksError)
    throw new Error(`Could not load tasks: ${tasksError.message}`);

  if (!tasks || tasks.length === 0) {
    // The worker already flipped its row to running; close it or the user
    // is blocked by "sync in progress" until the reaper gets to it.
    if (syncLogId) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          bounties_updated: 0,
          details: { updates: [], errors: [], statusChanges: [] },
        })
        .eq('id', syncLogId);
    }
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

  const syncLog = syncLogId
    ? { id: syncLogId }
    : (
        await supabase
          .from('sync_logs')
          .insert({
            user_id: userId,
            status: 'running',
            task_id: taskId ?? null,
          })
          .select('id')
          .single()
      ).data;

  let tasksUpdated = 0;
  // from → to per applied status change; the dashboard's Last Sync card
  // shows these, and the model output alone does not carry the old status.
  const jevObservations: JevObservation[] = [];
  // deciderFromEnv builds a closure; call it once.
  const decide = deciderFromEnv();
  const statusChanges: {
    taskId: string;
    from: string;
    to: string;
    confidence: number;
  }[] = [];

  try {
    const graph = createSyncGraph();

    const applyUpdate = async (update: TaskUpdate) => {
      if (update.confidence < 0.6) return;
      const currentTask = tasks.find((t) => t.id === update.taskId);
      if (!currentTask) return;

      const updateData: Record<string, unknown> = {
        ai_summary: update.summary,
        last_synced_at: new Date().toISOString(),
      };

      // Skip AI status override if user manually edited since last sync
      const wasManuallyEdited = userSetStatus(currentTask);

      // A status the user maintains by hand (description says "manually")
      // is never moved by the sync, whatever the model suggests.
      const isManualStatus = (finalStatuses as UserStatus[])?.some(
        (s) =>
          s.key === currentTask.status && /manually/i.test(s.description ?? '')
      );

      // Status change at high confidence
      if (
        update.suggestedStatus !== currentTask.status &&
        update.confidence >= 0.75 &&
        !wasManuallyEdited &&
        !isManualStatus
      ) {
        updateData.status = update.suggestedStatus;
        updateData.status_changed_at = new Date().toISOString();
        // Derive status_group from user's statuses
        const matchedStatus = (finalStatuses as UserStatus[])?.find(
          (s) => s.key === update.suggestedStatus
        );
        if (matchedStatus) {
          updateData.status_group = matchedStatus.group_name;
        }
      }

      // Rich fields — only update if AI provided a value (non-null)
      if (update.issue_title != null)
        updateData.issue_title = update.issue_title;
      if (update.pr_url != null) updateData.pr_url = update.pr_url;
      if (update.assigned_date != null)
        updateData.assigned_date = update.assigned_date;
      if (update.payment_date != null)
        updateData.payment_date = update.payment_date;
      // Only set amount if not already set by user
      if (update.amount != null && !currentTask.amount)
        updateData.amount = update.amount;

      const { error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', update.taskId);
      if (error) {
        throw new Error(
          `Task write failed for ${update.taskId}: ${error.message}`
        );
      }
      if (updateData.status) {
        statusChanges.push({
          taskId: update.taskId,
          from: currentTask.status,
          to: update.suggestedStatus,
          confidence: update.confidence,
        });
      }
      tasksUpdated++;
    };

    const result = await graph.invoke(
      {
        tasks: tasks as Task[],
        githubToken,
        analyze,
        onUpdate: applyUpdate,
        decide,
        jevMode: decide ? jevModeFromEnv() : 'off',
        gateThreshold: Number(process.env.JEV_GATE_THRESHOLD ?? 0.3),
        onJev: (observation: JevObservation) =>
          jevObservations.push(observation),
        skipped: [],
        onProgress: async (done, total) => {
          if (!syncLog) return;
          // Live counters for the dashboard card; the final update below
          // rewrites details in full, so nothing here needs to be complete.
          await supabase
            .from('sync_logs')
            .update({
              bounties_updated: tasksUpdated,
              details: {
                progress: { done, total, at: new Date().toISOString() },
                statusChanges,
              },
            })
            .eq('id', syncLog.id);
        },
        githubUsername,
        userStatuses: (finalStatuses as UserStatus[]) ?? [],
        currentIndex: 0,
        updates: [],
        errors: [],
      },
      // Two graph steps per task; LangGraph's default of 25 dies at 13 tasks.
      { recursionLimit: tasks.length * 2 + 10 }
    );

    // Update sync log
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          bounties_updated: tasksUpdated,
          details: {
            updates: result.updates,
            errors: result.errors,
            statusChanges,
            progress: { done: tasks.length, total: tasks.length },
            jev: jevObservations,
          },
        })
        .eq('id', syncLog.id)
        // A row the worker re-queued after losing this container must not
        // be flipped back by a stale process.
        .eq('status', 'running');
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
          // Tasks already applied before the abort stay applied; record them.
          bounties_updated: tasksUpdated,
          details: { statusChanges, jev: jevObservations },
        })
        .eq('id', syncLog.id)
        .eq('status', 'running');
    }
    throw err;
  }
}
