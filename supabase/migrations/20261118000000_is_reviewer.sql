ALTER TABLE public.tasks
  ADD COLUMN is_reviewer boolean;

COMMENT ON COLUMN public.tasks.is_reviewer IS
  'The user is the reviewer (C+) on this task, not the contributor. NULL until the sync or the user decides; the sync only fills NULL.';
