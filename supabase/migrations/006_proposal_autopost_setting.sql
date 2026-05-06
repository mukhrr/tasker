-- Adds a master kill-switch column for the auto-post feature.
-- Honored by both the cloud worker (poll cycle) and the extension's tab-side fast path.
alter table public.user_settings
  add column if not exists proposal_auto_post boolean not null default true;
