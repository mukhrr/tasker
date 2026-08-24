-- Catch-up: this column exists in the original production database but was
-- added there directly, without a migration. Fresh setups from this folder
-- were missing it, and /api/settings reads and writes it.
alter table public.user_settings
  add column if not exists github_username text;
