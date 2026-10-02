ALTER TABLE public.tasks
  ADD COLUMN additional_bugs_fixed integer NOT NULL DEFAULT 0
  CHECK (additional_bugs_fixed >= 0);

COMMENT ON COLUMN public.tasks.additional_bugs_fixed IS
  'Manually maintained in Tasker: additional bugs fixed beyond the original issue.';
