-- Every Jev answer the workers get, beside what the worker would have done
-- (baseline) and whether Jev's answer changed it (acted). Outcomes are joined
-- later from proposals.state and tasks, so shadow mode measures accuracy.
create table if not exists public.jev_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  worker text not null check (worker in ('drafter', 'analyzer')),
  decision text not null,
  issue_number integer not null,
  proposal_id uuid references public.proposals (id) on delete set null,
  analysis_request_id uuid references public.analysis_requests (id) on delete set null,
  answer jsonb not null,
  baseline jsonb,
  acted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists jev_decisions_issue_idx
  on public.jev_decisions (user_id, decision, issue_number);

alter table public.jev_decisions enable row level security;

create policy "Jev decisions are owner-only"
  on public.jev_decisions
  for select
  to authenticated
  using (auth.uid() = user_id);
