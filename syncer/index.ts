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
const STALE_RUNNING_MS = 30 * 60 * 1000;

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
            await supabase
              .from('user_settings')
              .update({ codex_auth_encrypted: encrypt(authJson) })
              .eq('id', settings.id);
            log(`🔑 ${settings.id} codex auth.json refreshed`);
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
  const { data: next } = await supabase
    .from('sync_logs')
    .select('id')
    .eq('status', 'queued')
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return null;
  const { data } = await supabase
    .from('sync_logs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();
  return (data as SyncLog | null) ?? null;
}

async function failLog(id: string, message: string) {
  await supabase
    .from('sync_logs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: message,
    })
    .eq('id', id);
}

async function processQueue() {
  for (;;) {
    const job = await claimNext();
    if (!job) return;
    const { data } = await supabase
      .from('user_settings')
      .select('*')
      .eq('id', job.user_id)
      .single();
    const settings = data as UserSettings | null;
    if (!settings) {
      await failLog(job.id, 'User settings not found');
      continue;
    }
    const label = `${job.user_id.slice(0, 8)}${job.task_id ? ` task ${job.task_id.slice(0, 8)}` : ''}`;
    log(`▶ ${label} via ${settings.ai_backend}`);
    try {
      const result = await runSync(job.user_id, {
        analyzer: analyzerFor(settings),
        syncLogId: job.id,
        taskId: job.task_id ?? undefined,
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
    await supabase.from('sync_logs').insert({
      user_id: user.id,
      status: 'queued',
      backend: user.ai_backend,
    });
    log(`⏰ ${user.id.slice(0, 8)} auto-sync queued (${user.ai_backend})`);
  }
}

// A row left 'running' by a crash or redeploy would block its user forever.
async function reapStale() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data } = await supabase
    .from('sync_logs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: 'Sync worker restarted mid-run',
    })
    .eq('status', 'running')
    .in('backend', CLI_BACKENDS)
    .lt('started_at', cutoff)
    .select('id');
  if (data?.length) log(`🧹 reaped ${data.length} stale running row(s)`);
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
