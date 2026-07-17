-- Auto-drafting pipeline: the sniper queues label-matched issues, and a
-- server-side drafter (Codex) fills the body and arms it, unattended.
--
-- Two new lifecycle states precede `draft`/`armed`:
--   queued   → the sniper saw a matching issue and enqueued it for drafting
--   drafting → the drafter has claimed the row and is generating the body
-- Both are server-owned; the extension renders them read-only and never mutates
-- them (see extension/src/background/index.ts guards).

alter table public.proposals
  drop constraint if exists proposals_state_check;

alter table public.proposals
  add constraint proposals_state_check
  check (state in ('queued', 'drafting', 'draft', 'armed', 'posting', 'posted', 'failed'));

alter table public.proposals
  -- 'manual' rows come from the extension (human authored); 'auto' rows are
  -- created by the sniper and owned by the drafter. Guards key off this so a
  -- human Save never clobbers an in-flight auto row and vice-versa.
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'auto')),
  -- Set when the deeper enrichment pass (stronger RCA, permalinks, diffs) lands.
  add column if not exists enriched_at timestamptz,
  -- Bounds the drafter's retry loop so a permanently-failing issue can't spin.
  add column if not exists draft_attempts integer not null default 0;

-- The drafter polls for its work with this exact predicate; a partial index
-- keeps that poll cheap as the table grows.
create index if not exists proposals_queued_idx
  on public.proposals (repo_owner, repo_name)
  where state in ('queued', 'drafting');
