-- "Run Auto-pilot" on a single issue is an explicit human request, not automatic
-- queueing — so it must be drafted even when the Auto-pilot master switch is off.
-- Before this, the per-issue button wrote the same (state='queued', origin='auto')
-- row the sniper writes, so the drafter's `if (!settings.autoPilot) return` skipped
-- it and the click silently queued work nothing would ever pick up (#97481 sat
-- queued for 31 minutes while the widget claimed a proposal was being written).
--
-- `force_draft` is that missing distinction: true = a human asked for this row by
-- hand. The sniper's enqueue never sets it (default false) and uses
-- resolution=ignore-duplicates, so it can neither set nor clear the flag.
alter table public.proposals
  add column if not exists force_draft boolean not null default false;

-- Partial index for the drafter's Auto-pilot-off poll (queued + explicitly asked).
create index if not exists proposals_force_draft_idx
  on public.proposals (created_at)
  where state = 'queued' and force_draft;
