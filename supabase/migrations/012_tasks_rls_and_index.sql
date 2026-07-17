-- Speed up per-user task queries (dashboard + table):
--
-- 1. The RLS policies from 002 use bare auth.uid(), which Postgres re-evaluates
--    per row. Recreate them with (select auth.uid()) so the planner evaluates
--    it once per statement (initplan). Same semantics, same roles.
-- 2. Add an index on (user_id, created_at desc) to cover the hot query
--    `where user_id = ? order by created_at desc` without a Sort node.
--
-- Committed migrations are drifted from the live DB: 002 creates `bounties`,
-- which was renamed to `tasks` outside of migrations, so live policy names are
-- unknown. Everything here is guarded and name-agnostic — the file is a no-op
-- on a database without public.tasks, and safe to re-run.

do $$
declare
  pol record;
  fk_col text;
begin
  if to_regclass('public.tasks') is null then
    return;
  end if;

  -- tasks: recreate owner-only policies in initplan form
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
  loop
    execute format('drop policy %I on public.tasks', pol.policyname);
  end loop;

  create policy "Users can view own tasks"
    on public.tasks for select
    to authenticated
    using ((select auth.uid()) = user_id);

  create policy "Users can create own tasks"
    on public.tasks for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

  create policy "Users can update own tasks"
    on public.tasks for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

  create policy "Users can delete own tasks"
    on public.tasks for delete
    to authenticated
    using ((select auth.uid()) = user_id);

  create index if not exists idx_tasks_user_created_at
    on public.tasks (user_id, created_at desc);

  -- custom_columns: same initplan rewrite
  if to_regclass('public.custom_columns') is not null then
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'custom_columns'
    loop
      execute format('drop policy %I on public.custom_columns', pol.policyname);
    end loop;

    create policy "Users can manage own custom columns"
      on public.custom_columns for all
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  -- custom_field_values: ownership via exists() against tasks; the live FK
  -- column may be task_id (current app types) or bounty_id (002) — introspect
  if to_regclass('public.custom_field_values') is not null then
    select column_name into fk_col
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'custom_field_values'
      and column_name in ('task_id', 'bounty_id')
    limit 1;

    if fk_col is not null then
      for pol in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = 'custom_field_values'
      loop
        execute format('drop policy %I on public.custom_field_values', pol.policyname);
      end loop;

      execute format($f$
        create policy "Users can manage own custom field values"
          on public.custom_field_values for all
          to authenticated
          using (exists (
            select 1 from public.tasks
            where tasks.id = custom_field_values.%1$I
              and tasks.user_id = (select auth.uid())
          ))
          with check (exists (
            select 1 from public.tasks
            where tasks.id = custom_field_values.%1$I
              and tasks.user_id = (select auth.uid())
          ))
      $f$, fk_col);
    end if;
  end if;
end $$;
