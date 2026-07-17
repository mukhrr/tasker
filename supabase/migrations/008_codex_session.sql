-- Track the Codex CLI session behind each auto-drafted proposal so it can be
-- resumed from a terminal (`codex exec resume <id>`). Codex's own thread names
-- are an auto-incrementing counter, not the issue number, so we store the stable
-- session UUID and expose a resume command keyed to the issue.
alter table public.proposals
  add column if not exists codex_session_id text;
