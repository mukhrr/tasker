-- Resume-in-chat: store the Claude Code session id of each analysis run so the
-- widget can offer a copyable `claude --resume <id>` command.
alter table public.analysis_requests
  add column if not exists claude_session_id text;
