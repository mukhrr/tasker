import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { runSync } from '../src/lib/agent/runner';
import { isSyncDue } from '../src/lib/agent/schedule';
import { CLI_BACKENDS } from '../src/lib/agent/backend';
import { decrypt, encrypt } from '../src/lib/encryption';
import { claudeCliAnalyzer, codexCliAnalyzer } from './analyzers';
import type { Analyzer } from '../src/lib/agent/llm';
import type { SyncLog, UserSettings } from '../src/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000);
// A run heartbeats after every task (details.progress.at); one Codex call
// caps at CLI_TIMEOUT_MS, so silence this long means the container is gone.
const STALE_RUNNING_MS = 10 * 60 * 1000;
let currentJobId: string | null = null;

if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ENCRYPTION_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or ENCRYPTION_KEY'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

function analyzerFor(settings: UserSettings): Analyzer {
  switch (settings.ai_backend) {
    case 'claude_cli':
      if (!settings.claude_oauth_token_encrypted) {
        throw new Error(
          'Claude CLI is not connected. Paste your setup-token in Settings.'
        );
      }
      return claudeCliAnalyzer(
        decrypt(settings.claude_oauth_token_encrypted),
        settings.id
      );
    case 'codex_cli':
      if (!settings.codex_auth_encrypted) {
        throw new Error(
          'Codex CLI is not connected. Paste your auth.json in Settings.'
        );
      }
      return codexCliAnalyzer(
        decrypt(settings.codex_auth_encrypted),
        settings.id,
        {
          onAuthChanged: async (authJson) => {
            const { error } = await supabase
              .from('user_settings')
              .update({ codex_auth_encrypted: encrypt(authJson) })
              .eq('id', settings.id);
            if (error) {
              throw new Error(
                `codex auth.json write-back failed: ${error.message}`
              );
            }
            log(`🔑 ${settings.id.slice(0, 8)} codex auth.json refreshed`);
          },
        }
      );
    default:
      throw new Error(
        `Backend ${settings.ai_backend} is not handled by the syncer`
      );
  }
}

// Atomic queued → running; a second worker or a redeploy racing us loses.
async function claimNext(): Promise<SyncLog | null> {
  const { data: next, error: selectError } = await supabase
    .from('sync_logs')
    .select('id')
    .eq('status', 'queued')
    .in('backend', CLI_BACKENDS)
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(`queue read failed: ${selectError.message}`);
  if (!next) return null;
  const { data, error } = await supabase
    .from('sync_logs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`queue claim failed: ${error.message}`);
  return (data as SyncLog | null) ?? null;
}

async function failLog(id: string, message: string) {
  const { error } = await supabase
    .from('sync_logs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: message,
    })
    .eq('id', id);
  if (error) log(`could not mark ${id} failed: ${error.message}`);
}

type RunningRow = {
  id: string;
  started_at: string;
  details: Record<string, unknown> | null;
};

// Put a run its container will not finish back on the queue. Tasks already
// synced are skipped on the next attempt via resumeAfter.
async function requeue(row: RunningRow, why: string) {
  const resumeAfter =
    (row.details?.resumeAfter as string | undefined) ?? row.started_at;
  const { error } = await supabase
    .from('sync_logs')
    .update({
      status: 'queued',
      details: { ...(row.details ?? {}), resumeAfter },
      error_message: null,
    })
    .eq('id', row.id)
    .eq('status', 'running');
  if (error) log(`could not requeue ${row.id}: ${error.message}`);
  else log(`↩ ${row.id.slice(0, 8)} requeued (${why})`);
}

async function processQueue() {
  for (;;) {
    const job = await claimNext();
    if (!job) return;
    currentJobId = job.id;
    const { data, error: settingsError } = await supabase
      .from('user_settings')
      .select('*')
      .eq('id', job.user_id)
      .single();
    const settings = data as UserSettings | null;
    if (settingsError || !settings) {
      await failLog(
        job.id,
        settingsError
          ? `Could not load settings: ${settingsError.message}`
          : 'User settings not found'
      );
      currentJobId = null;
      continue;
    }
    const resumeAfter = job.details?.resumeAfter as string | undefined;
    const label = `${job.user_id.slice(0, 8)}${job.task_id ? ` task ${job.task_id.slice(0, 8)}` : ''}`;
    log(
      `▶ ${label} via ${settings.ai_backend}${resumeAfter ? ' (resumed)' : ''}`
    );
    try {
      const result = await runSync(job.user_id, {
        analyzer: analyzerFor(settings),
        syncLogId: job.id,
        taskId: job.task_id ?? undefined,
        resumeAfter,
      });
      log(
        `✓ ${label}: ${result.tasks_updated} updated, ${result.errors.length} errors`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // runSync marks its own log failed before rethrowing; this covers
      // analyzerFor throwing before the runner ever started.
      await failLog(job.id, message);
      log(`✗ ${label}: ${message}`);
    } finally {
      currentJobId = null;
    }
  }
}

// Auto-sync for CLI users: enqueue a full sync when the interval has elapsed.
// API-key users stay on /api/cron/sync.
async function enqueueDueUsers() {
  const { data: users } = await supabase
    .from('user_settings')
    .select('id, sync_interval_hours, ai_backend')
    .eq('auto_sync_enabled', true)
    .in('ai_backend', CLI_BACKENDS);
  for (const user of users ?? []) {
    const { data: last } = await supabase
      .from('sync_logs')
      .select('status, started_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && (last.status === 'queued' || last.status === 'running'))
      continue;
    if (!isSyncDue(last?.started_at, user.sync_interval_hours)) continue;
    const { error } = await supabase.from('sync_logs').insert({
      user_id: user.id,
      status: 'queued',
      backend: user.ai_backend,
    });
    if (error) {
      log(
        `could not queue auto-sync for ${user.id.slice(0, 8)}: ${error.message}`
      );
    } else {
      log(`⏰ ${user.id.slice(0, 8)} auto-sync queued (${user.ai_backend})`);
    }
  }
}

// A row left 'running' by a crash or redeploy would block its user forever.
// Silence is measured from the last heartbeat, not the start, so a long
// but live run is never touched.
async function reapStale() {
  const { data, error } = await supabase
    .from('sync_logs')
    .select('id, started_at, details')
    .eq('status', 'running')
    .in('backend', CLI_BACKENDS);
  if (error) throw new Error(`reap read failed: ${error.message}`);
  const cutoff = Date.now() - STALE_RUNNING_MS;
  for (const row of (data ?? []) as RunningRow[]) {
    if (row.id === currentJobId) continue;
    const progress = row.details?.progress as { at?: string } | undefined;
    const lastBeat = new Date(progress?.at ?? row.started_at).getTime();
    if (lastBeat < cutoff) await requeue(row, 'no heartbeat');
  }
}

async function tick() {
  try {
    await reapStale();
    await enqueueDueUsers();
    await processQueue();
  } catch (err) {
    log(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Railway sends SIGTERM on every redeploy; hand the in-flight run back to
// the queue instead of leaving it 'running' until the reaper notices.
async function shutdown(signal: string) {
  log(`${signal} received, shutting down`);
  if (currentJobId) {
    const { data } = await supabase
      .from('sync_logs')
      .select('id, started_at, details')
      .eq('id', currentJobId)
      .maybeSingle();
    if (data) await requeue(data as RunningRow, signal);
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main() {
  log(
    `syncer up: poll=${POLL_INTERVAL_MS}ms claude_model=${process.env.CLAUDE_MODEL || 'default'} codex_model=${process.env.CODEX_MODEL || 'default'}`
  );
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
