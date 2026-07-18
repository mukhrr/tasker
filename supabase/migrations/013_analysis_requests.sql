-- Queue for "Run Claude analysis": the extension inserts a request, a local
-- analyzer daemon on the user's Mac (analyzer/analyzer.mjs) claims it, runs
-- Claude Code headless against the local Expensify/App checkout (reproduce via
-- Playwright → fix locally → update the posted proposal → stash), then writes
-- the outcome back here for the widget to display.
create table if not exists public.analysis_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  issue_number integer not null,
  state text not null default 'queued'
    check (state in ('queued', 'running', 'done', 'failed')),
  result_summary text,
  stash_ref text,
  last_error text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (user_id, repo_owner, repo_name, issue_number)
);

alter table public.analysis_requests enable row level security;

create policy "Analysis requests are owner-only"
  on public.analysis_requests
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger analysis_requests_updated_at
  before update on public.analysis_requests
  for each row execute procedure public.update_updated_at();

create index if not exists analysis_requests_queued_idx
  on public.analysis_requests (state, created_at)
  where state in ('queued', 'running');
