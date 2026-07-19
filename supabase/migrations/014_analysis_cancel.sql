-- Cancelable analyses: 'canceled' is a terminal state set by the extension's
-- Cancel button (queued → canceled prevents pickup; running → canceled makes
-- the analyzer daemon kill the in-flight claude run).
alter table public.analysis_requests drop constraint if exists analysis_requests_state_check;
alter table public.analysis_requests add constraint analysis_requests_state_check
  check (state in ('queued', 'running', 'done', 'failed', 'canceled'));
