-- Lock down public.profiles: the SELECT policy was `to public using (true)`,
-- which let ANY holder of the anon key (the extension ships it, so effectively
-- anyone) read every profile row. Restrict reads to the authenticated owner.
--
-- Drops any existing SELECT policy on profiles (name-agnostic) and recreates an
-- owner-only one. The UPDATE policy already uses (auth.uid() = id) and is left
-- as-is (anon has no auth.uid(), so it can't update).

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.profiles', pol.policyname);
  end loop;
end $$;

create policy "Profiles readable by their owner"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);
