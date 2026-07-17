-- Auto-pilot toggle: controls whether the server-side drafter auto-drafts queued
-- issues (writes + validates + arms proposals). Independent of proposal_auto_post,
-- which controls POSTING (the sniper + the drafter's direct-post). Default true so
-- existing behavior (auto-drafting on) is preserved.
alter table public.user_settings
  add column if not exists autopilot_enabled boolean not null default true;
