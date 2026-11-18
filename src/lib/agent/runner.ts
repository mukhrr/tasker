import { createClient } from '@supabase/supabase-js';
import { createSyncGraph, type TaskUpdate } from './graph';
import { anthropicAnalyzer, type Analyzer } from './llm';
import { deciderFromEnv, jevModeFromEnv } from './jev';
import type { JevObservation } from './graph';
import {
  assignedDateToWrite,
  paymentDateToWrite,
  reviewerToWrite,
  userSetStatus,
} from './manual';
import { decrypt, decryptIfEncrypted } from '@/lib/encryption';
import {
  fetchAllIssueEvents,
  parseIssueUrl,
  searchAssignedIssues,
} from '@/lib/github';
import { discoverAssigned, type DiscoveredTask } from './discover';
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

  // Created before discovery: the routes' "sync in progress" check looks
  // for this row, and discovery can take several GitHub calls.
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

  let discovered: DiscoveredTask[] = [];
  let discoveryErrors: string[] = [];
  if (resumeAfter && syncLog) {
    // The first attempt already ran discovery; keep what it recorded.
    const { data: prior } = await supabase
      .from('sync_logs')
      .select('details')
      .eq('id', syncLog.id)
      .single();
    discovered = (prior?.details?.discovered as DiscoveredTask[]) ?? [];
    discoveryErrors = (prior?.details?.discoveryErrors as string[]) ?? [];
  } else if (!taskId && !resumeAfter) {
    // Before the task query, so rows it adds are synced by this same run.
    const found = await discoverAssigned(
      {
        search: (since) =>
          searchAssignedIssues(githubUsername, since, githubToken),
        events: (owner, repo, number) =>
          fetchAllIssueEvents(owner, repo, number, githubToken),
        // Every row, archived and finished ones too, so a closed-out task
        // is never added again.
        trackedRows: async () => {
          const { data, error } = await supabase
            .from('tasks')
            .select('issue_url, repo_owner, repo_name, issue_number')
            .eq('user_id', userId);
          if (error) throw new Error(error.message);
          return data ?? [];
        },
        offeredUrls: async (since) => {
          const { data, error } = await supabase
            .from('sync_logs')
            .select('discovered:details->discovered')
            .eq('user_id', userId)
            .gte('started_at', since);
          if (error) throw new Error(error.message);
          return (data ?? []).flatMap((r) =>
            ((r.discovered as DiscoveredTask[] | null) ?? []).map(
              (d) => d.issue_url
            )
          );
        },
        insert: async (task) => {
          const { data, error } = await supabase
            .from('tasks')
            .insert({ user_id: userId, ...task })
            .select('id')
            .single();
          if (error || !data) {
            throw new Error(error?.message ?? 'no row returned');
          }
          return data.id as string;
        },
      },
      {
        username: githubUsername,
        assignedStatus: (finalStatuses as UserStatus[] | null)?.find(
          (s) => s.key === 'assigned'
        ),
        now: new Date(),
      }
    );
    discovered = found.discovered;
    discoveryErrors = found.errors;
    // Stored now so a run killed before its first progress write keeps it.
    if (syncLog && (discovered.length || discoveryErrors.length)) {
      await supabase
        .from('sync_logs')
        .update({ details: { discovered, discoveryErrors } })
        .eq('id', syncLog.id);
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
  if (tasksError) {
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Could not load tasks: ${tasksError.message}`,
          details: { discovered, discoveryErrors },
        })
        .eq('id', syncLog.id)
        .eq('status', 'running');
    }
    throw new Error(`Could not load tasks: ${tasksError.message}`);
  }

  if (!tasks || tasks.length === 0) {
    // Close the row, or the user is blocked by "sync in progress" until
    // the reaper gets to it.
    if (syncLog) {
      await supabase
        .from('sync_logs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          bounties_updated: 0,
          details: {
            updates: [],
            errors: discoveryErrors,
            statusChanges: [],
            discovered,
            discoveryErrors,
          },
        })
        .eq('id', syncLog.id);
    }
    return { tasks_updated: 0, errors: [], skipped: 0 };
  }

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
  // SYNC_STATUS_MODE=apply lets the sync move statuses itself. The default
  // only records them here and the Last Sync card offers each as an Apply.
  const applyStatus = process.env.SYNC_STATUS_MODE === 'apply';
  const statusSuggestions: typeof statusChanges = [];
  const fieldErrors: string[] = [];

  try {
    const graph = createSyncGraph();

    const applyUpdate = async (update: TaskUpdate) => {
      if (update.confidence < 0.6) return;
      const currentTask = tasks.find((t) => t.id === update.taskId);
      if (!currentTask) return;

      // One timestamp for both, so a status the sync set never reads as a
      // hand edit on the next run.
      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        ai_summary: update.summary,
        last_synced_at: now,
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
      const statusChange =
        update.suggestedStatus !== currentTask.status &&
        update.confidence >= 0.75 &&
        !wasManuallyEdited &&
        !isManualStatus;
      if (statusChange && !applyStatus) {
        statusSuggestions.push({
          taskId: update.taskId,
          from: currentTask.status,
          to: update.suggestedStatus,
          confidence: update.confidence,
        });
      } else if (statusChange) {
        updateData.status = update.suggestedStatus;
        updateData.status_changed_at = now;
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
      const assignedDate = assignedDateToWrite(
        currentTask,
        update.assigned_date
      );
      if (assignedDate) updateData.assigned_date = assignedDate;
      const paymentDate = paymentDateToWrite(currentTask, update.payment_date);
      if (paymentDate) updateData.payment_date = paymentDate;
      // Only set amount if not already set by user
      if (update.amount != null && !currentTask.amount)
        updateData.amount = update.amount;

      if (update.issue_url) {
        const target = parseIssueUrl(update.issue_url);
        const { data: existing } = target
          ? await supabase
              .from('tasks')
              .select('id')
              .eq('user_id', userId)
              .ilike('repo_owner', target.owner)
              .ilike('repo_name', target.repo)
              .eq('issue_number', target.number)
              .neq('id', currentTask.id)
              .limit(1)
          : { data: null };
        if (target && !existing?.length) {
          updateData.issue_url = update.issue_url;
          updateData.repo_owner = target.owner;
          updateData.repo_name = target.repo;
          updateData.issue_number = target.number;
          // The next sync rewrites the summary, so the origin lives in the note.
          const origin = `From PR comment: ${currentTask.issue_url}`;
          updateData.note = currentTask.note
            ? `${currentTask.note}\n${origin}`
            : origin;
        } else if (target) {
          updateData.ai_summary = `${update.summary} ${update.issue_url} is already another task.`;
        }
      }

      const isReviewer = reviewerToWrite(currentTask, update.role);

      if (update.payment_moved_to && update.confidence >= 0.75) {
        const target = parseIssueUrl(update.payment_moved_to);
        if (target) {
          const { data: existing } = await supabase
            .from('tasks')
            .select('id')
            .eq('user_id', userId)
            .ilike('repo_owner', target.owner)
            .ilike('repo_name', target.repo)
            .eq('issue_number', target.number)
            .limit(1);
          if (!existing?.length) {
            const status =
              (updateData.status as string | undefined) ?? currentTask.status;
            const group =
              (finalStatuses as UserStatus[])?.find((s) => s.key === status)
                ?.group_name ?? currentTask.status_group;
            const { error: insertError } = await supabase.from('tasks').insert({
              user_id: userId,
              issue_url: update.payment_moved_to,
              repo_owner: target.owner,
              repo_name: target.repo,
              issue_number: target.number,
              status,
              status_group: group,
              pr_url: currentTask.pr_url,
              assigned_date: currentTask.assigned_date,
              is_reviewer: isReviewer ?? currentTask.is_reviewer,
              note: `Payment moved from ${currentTask.issue_url}`,
            });
            if (insertError) {
              throw new Error(
                `Task write failed for ${update.payment_moved_to}: ${insertError.message}`
              );
            }
          }
          updateData.archived = true;
          const moved = `Payment moved to ${update.payment_moved_to}`;
          updateData.note = currentTask.note
            ? `${currentTask.note}\n${moved}`
            : moved;
        }
      }

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

      if (isReviewer !== null) {
        // Its own write, filtered on null: a badge the user toggled while
        // this run was in flight must win. Not fatal: the badge is a label.
        const { error: roleError } = await supabase
          .from('tasks')
          .update({ is_reviewer: isReviewer })
          .eq('id', update.taskId)
          .is('is_reviewer', null);
        if (roleError) {
          fieldErrors.push(
            `Could not set the C+ badge on ${currentTask.issue_url}: ${roleError.message}`
          );
        }
      }
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
                statusSuggestions,
                discovered,
                discoveryErrors,
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
            errors: [...discoveryErrors, ...result.errors, ...fieldErrors],
            statusChanges,
            statusSuggestions,
            discovered,
            discoveryErrors,
            progress: { done: tasks.length, total: tasks.length },
            jev: jevObservations,
            skipped: result.skipped.length,
          },
        })
        .eq('id', syncLog.id)
        // A row the worker re-queued after losing this container must not
        // be flipped back by a stale process.
        .eq('status', 'running');
    }

    return {
      tasks_updated: tasksUpdated,
      // Discovery errors stay in the log: the route treats returned errors
      // with nothing updated as a failed sync.
      errors: result.errors,
      skipped: result.skipped.length,
    };
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
          details: {
            statusChanges,
            statusSuggestions,
            jev: jevObservations,
            discovered,
            errors: discoveryErrors,
            discoveryErrors,
          },
        })
        .eq('id', syncLog.id)
        .eq('status', 'running');
    }
    throw err;
  }
}
