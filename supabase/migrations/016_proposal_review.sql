-- Melvin-aware review gate: after the drafter arms an auto proposal, the local
-- Claude CLI (analyzer daemon) compares it against MelvinBot's own proposal and
-- either disarms duplicates (armed → draft) or keeps + Telegram-flags distinct
-- ones. `reviewed_at` is the claim/dedup marker: NULL = not yet reviewed (the
-- daemon's review poll selects these), set = review has run (kept armed) or the
-- row was disarmed. Nullable, additive — no state CHECK change, so arming stays
-- a pure Railway/drafter concern and never depends on the Mac daemon.
alter table public.proposals
  add column if not exists reviewed_at timestamptz;

-- Partial index for the daemon's review poll (armed + auto + unreviewed).
create index if not exists proposals_needs_review_idx
  on public.proposals (created_at)
  where state = 'armed' and origin = 'auto' and reviewed_at is null;
