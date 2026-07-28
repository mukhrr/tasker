-- Live phase marker for a running analysis. Claude's own session ending is NOT
-- the end of the job: the daemon still runs red/green jest, an optional browser
-- replay, stashing, and the proposal update — a tail that can take minutes. With
-- only a flat "Analyzing…" the widget looks stuck once the session itself is
-- visibly finished. The daemon publishes the current phase here; the widget
-- shows it. Nullable and cleared on done/failed, so a stale phase never lingers.
alter table public.analysis_requests
  add column if not exists progress text;
