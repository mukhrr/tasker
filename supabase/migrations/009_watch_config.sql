-- Sync the extension's watched label groups + excluded labels to the server so
-- the sniper's auto-draft queueing follows the same config the user edits in the
-- extension (single source of truth), instead of hardcoded Railway env vars.
--
-- watched_label_groups: array of groups, each an array of label names (AND within
--   a group, OR across groups) — mirrors the extension's string[][].
-- excluded_labels: label names that disqualify an issue if any is present.
-- NULL means "not synced yet" — the sniper falls back to its env defaults.
alter table public.user_settings
  add column if not exists watched_label_groups jsonb,
  add column if not exists excluded_labels jsonb;
