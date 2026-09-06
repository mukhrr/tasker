-- Auto-analyzer master switch: a BEATS arm queues a deep Claude analysis
-- automatically. Same absent-means-on semantics as the other two toggles.
alter table public.user_settings
  add column if not exists auto_analyze_enabled boolean not null default true;
