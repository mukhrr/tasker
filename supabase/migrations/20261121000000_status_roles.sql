-- Each status belongs to the Committer tab, the Reviewer tab, or both.
-- Applied by hand through the Management API (never `supabase db push`).
begin;

alter table public.user_statuses
  add column if not exists role text not null default 'both'
  check (role in ('both', 'contributor', 'reviewer'));

update public.user_statuses set role = 'contributor'
where key in ('in_proposal', 'promising', 'got_cplus', 'update_proposal', 'changes_required', 'reviewing');

-- The reviewer's own statuses, at the end of In progress.
insert into public.user_statuses (user_id, key, label, description, color, group_name, position, role)
select u.user_id, v.key, v.label, v.description, v.color, 'in_progress', u.pos + v.n, 'reviewer'
from (
  select user_id, coalesce(max(position) filter (where group_name = 'in_progress'), -1) as pos
  from public.user_statuses group by user_id
) u
cross join (values
  (1, 'review_due', 'Review due', 'You are the C+ reviewer and owe a review: the PR author pushed or replied since your last review, or you have not reviewed yet', 'blue'),
  (2, 'waiting_on_author', 'Waiting on author', 'You are the C+ reviewer and asked for changes; waiting on the PR author', 'orange')
) as v(n, key, label, description, color)
where not exists (
  select 1 from public.user_statuses s where s.user_id = u.user_id and s.key = v.key
);

create or replace function public.seed_default_statuses(p_user_id uuid)
returns void
language plpgsql
security definer
as $function$
begin
  if not exists (select 1 from public.user_statuses where user_id = p_user_id) then
    insert into public.user_statuses (user_id, key, label, description, color, group_name, position, role) values
      (p_user_id, 'in_proposal', 'In Proposal', 'You submitted a proposal/comment on the issue, waiting for response', 'gray', 'todo', 0, 'contributor'),
      (p_user_id, 'promising', 'Promising', 'Got positive signals (e.g. "looks good", "interesting approach") but not yet assigned', 'yellow', 'todo', 1, 'contributor'),
      (p_user_id, 'got_cplus', 'Got C+', 'Received a C+ review/comment (Expensify contributor plus designation)', 'green', 'todo', 2, 'contributor'),
      (p_user_id, 'update_proposal', 'Update Proposal', 'Reviewer asked to update or revise the proposal before assignment', 'red', 'todo', 3, 'contributor'),
      (p_user_id, 'assigned', 'Assigned', 'You are assigned to the issue but no PR yet, or PR is still draft', 'blue', 'in_progress', 0, 'both'),
      (p_user_id, 'reviewing', 'Reviewing', 'PR is open, NOT draft, and ready for review', 'purple', 'in_progress', 1, 'contributor'),
      (p_user_id, 'changes_required', 'Changes Required', 'PR needs your action: review requested changes, you were tagged/mentioned, or comments requiring your response', 'red', 'in_progress', 2, 'contributor'),
      (p_user_id, 'awaiting_payment', 'Awaiting Payment', 'Work is done, PR merged, waiting for payment (comments about payment/invoice)', 'pink', 'in_progress', 3, 'both'),
      (p_user_id, 'merged', 'Merged', 'PR has been merged into the target branch', 'gray', 'in_progress', 4, 'both'),
      (p_user_id, 'review_due', 'Review due', 'You are the C+ reviewer and owe a review: the PR author pushed or replied since your last review, or you have not reviewed yet', 'blue', 'in_progress', 5, 'reviewer'),
      (p_user_id, 'waiting_on_author', 'Waiting on author', 'You are the C+ reviewer and asked for changes; waiting on the PR author', 'orange', 'in_progress', 6, 'reviewer'),
      (p_user_id, 'regression', 'Regression', 'A regression was reported after the PR was merged', 'red', 'complete', 0, 'both'),
      (p_user_id, 'paid', 'Paid', 'Payment has been confirmed for this bounty', 'green', 'complete', 1, 'both'),
      (p_user_id, 'wasted', 'Wasted', 'Task was abandoned, rejected, or issue closed without your PR merged', 'red', 'complete', 2, 'both');
  end if;
end;
$function$;

commit;
