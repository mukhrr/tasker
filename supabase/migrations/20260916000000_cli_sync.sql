-- Sync can run on the user's own Claude Code / Codex subscription instead of an
-- Anthropic API key. CLI syncs are executed by the syncer worker (syncer/), so
-- sync_logs doubles as its queue: the web app inserts 'queued', the worker claims.
alter table public.user_settings
  add column if not exists ai_backend text not null default 'api'
    check (ai_backend in ('api', 'claude_cli', 'codex_cli')),
  add column if not exists claude_oauth_token_encrypted text,
  add column if not exists codex_auth_encrypted text;

alter table public.sync_logs
  drop constraint if exists sync_logs_status_check;
alter table public.sync_logs
  add constraint sync_logs_status_check
    check (status in ('queued', 'running', 'completed', 'failed'));

alter table public.sync_logs
  add column if not exists task_id uuid references public.tasks(id) on delete cascade,
  add column if not exists backend text;

create index if not exists sync_logs_queued_idx
  on public.sync_logs (started_at) where status = 'queued';
