-- Proposals: drafted/armed comment bodies that auto-post when the
-- target issue gets the configured "ready" label (typically "Help Wanted").
create table public.proposals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  repo_owner text not null,
  repo_name text not null,
  issue_number integer not null,
  body text not null default '',
  state text not null default 'draft'
    check (state in ('draft', 'armed', 'posting', 'posted', 'failed')),
  github_comment_id bigint,
  last_error text,
  posted_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (user_id, repo_owner, repo_name, issue_number)
);

create index proposals_armed_idx
  on public.proposals (repo_owner, repo_name)
  where state = 'armed';

alter table public.proposals enable row level security;

create policy "Users can view own proposals"
  on public.proposals for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create own proposals"
  on public.proposals for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own proposals"
  on public.proposals for update
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can delete own proposals"
  on public.proposals for delete
  to authenticated
  using (auth.uid() = user_id);

create trigger proposals_updated_at
  before update on public.proposals
  for each row execute procedure public.update_updated_at();

-- Per-repo poll cursor so /issues/events stays cheap (304 on no change).
create table public.repo_poll_state (
  repo_owner text not null,
  repo_name text not null,
  etag text,
  last_polled_at timestamptz,
  primary key (repo_owner, repo_name)
);

-- Service-role only; no RLS policies needed for clients.
alter table public.repo_poll_state enable row level security;

-- Realtime so the extension widget reflects state transitions instantly.
alter publication supabase_realtime add table public.proposals;
