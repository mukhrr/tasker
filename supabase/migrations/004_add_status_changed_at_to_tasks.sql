-- Add status_changed_at to track when status was last changed
ALTER TABLE tasks ADD COLUMN status_changed_at timestamptz DEFAULT now();

-- Backfill: set to updated_at for existing rows as best approximation
UPDATE tasks SET status_changed_at = updated_at WHERE status_changed_at IS NULL;
