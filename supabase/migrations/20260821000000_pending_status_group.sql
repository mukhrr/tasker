-- Add a dedicated Pending stage between active work and completion.
alter table public.user_statuses
  drop constraint if exists user_statuses_group_name_check;

alter table public.tasks
  drop constraint if exists tasks_status_group_check;

alter table public.user_statuses
  add constraint user_statuses_group_name_check
  check (group_name in ('todo', 'in_progress', 'pending', 'complete'));

alter table public.tasks
  add constraint tasks_status_group_check
  check (status_group in ('todo', 'in_progress', 'pending', 'complete'));

update public.user_statuses
set group_name = 'pending'
where key in ('awaiting_payment', 'submit_in_nd', 'submitted_in_nd');

update public.tasks
set status_group = 'pending'
where status in ('awaiting_payment', 'submit_in_nd', 'submitted_in_nd');
