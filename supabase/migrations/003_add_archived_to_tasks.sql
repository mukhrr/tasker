-- Add archived column to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- Index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks (user_id, archived);
