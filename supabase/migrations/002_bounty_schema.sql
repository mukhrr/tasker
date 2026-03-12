-- Drop old tasks table
drop table if exists public.tasks cascade;

-- Add github_access_token_encrypted to profiles
alter table public.profiles add column if not exists github_access_token_encrypted text;

-- Update handle_new_user to capture github_username from OAuth metadata
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, github_username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'user_name'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Bounties table
create table public.bounties (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  issue_url text not null,
  pr_url text,
  status text not null default 'in_proposal'
    check (status in (
      'in_proposal', 'promising', 'got_cplus', 'update_proposal',
      'assigned', 'reviewing', 'changes_required', 'awaiting_payment',
      'merged', 'regression', 'paid', 'wasted'
    )),
  status_group text generated always as (
    case
      when status in ('in_proposal', 'promising', 'got_cplus', 'update_proposal') then 'todo'
      when status in ('assigned', 'reviewing', 'changes_required', 'awaiting_payment', 'merged') then 'in_progress'
      when status in ('regression', 'paid', 'wasted') then 'complete'
    end
  ) stored,
  amount numeric(10,2),
  payment_date date,
  assigned_date date,
  note text,
  ai_summary text,
  repo_owner text,
  repo_name text,
  issue_number integer,
  last_synced_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.bounties enable row level security;

create policy "Users can view own bounties"
  on public.bounties for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create own bounties"
  on public.bounties for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own bounties"
  on public.bounties for update
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can delete own bounties"
  on public.bounties for delete
  to authenticated
  using (auth.uid() = user_id);

create trigger bounties_updated_at
  before update on public.bounties
  for each row execute procedure public.update_updated_at();

-- Custom columns table
create table public.custom_columns (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  field_type text not null default 'text'
    check (field_type in ('text', 'date', 'number', 'url', 'select')),
  select_options jsonb default '[]'::jsonb,
  position integer not null default 0,
  created_at timestamptz default now() not null
);

alter table public.custom_columns enable row level security;

create policy "Users can manage own custom columns"
  on public.custom_columns for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Custom field values table
create table public.custom_field_values (
  id uuid default gen_random_uuid() primary key,
  bounty_id uuid references public.bounties on delete cascade not null,
  column_id uuid references public.custom_columns on delete cascade not null,
  value text,
  unique (bounty_id, column_id)
);

alter table public.custom_field_values enable row level security;

create policy "Users can manage own custom field values"
  on public.custom_field_values for all
  to authenticated
  using (
    exists (
      select 1 from public.bounties
      where bounties.id = custom_field_values.bounty_id
      and bounties.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.bounties
      where bounties.id = custom_field_values.bounty_id
      and bounties.user_id = auth.uid()
    )
  );

-- User settings table
create table public.user_settings (
  id uuid references auth.users on delete cascade primary key,
  ai_api_key_encrypted text,
  auto_sync_enabled boolean default false,
  sync_interval_hours integer default 6,
  github_token_encrypted text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.user_settings enable row level security;

create policy "Users can manage own settings"
  on public.user_settings for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute procedure public.update_updated_at();

-- Sync logs table
create table public.sync_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  started_at timestamptz default now() not null,
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  bounties_updated integer default 0,
  error_message text,
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

alter table public.sync_logs enable row level security;

create policy "Users can view own sync logs"
  on public.sync_logs for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create own sync logs"
  on public.sync_logs for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own sync logs"
  on public.sync_logs for update
  to authenticated
  using (auth.uid() = user_id);

-- Enable realtime for bounties
alter publication supabase_realtime add table public.bounties;
