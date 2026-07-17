// Status is now dynamic per-user, so TaskStatus is just a string alias
export type TaskStatus = string;

export type TaskStatusGroup = 'todo' | 'in_progress' | 'complete';

export interface UserStatus {
  id: string;
  user_id: string;
  key: string;
  label: string;
  description: string;
  color: string;
  group_name: TaskStatusGroup;
  position: number;
  created_at: string;
}

export type CustomFieldType = 'text' | 'date' | 'number' | 'url' | 'select';

export interface Task {
  id: string;
  user_id: string;
  issue_url: string;
  issue_title: string | null;
  pr_url: string | null;
  status: TaskStatus;
  status_group: TaskStatusGroup;
  amount: number | null;
  payment_date: string | null;
  assigned_date: string | null;
  note: string | null;
  ai_summary: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  issue_number: number | null;
  archived: boolean;
  last_synced_at: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
}

// Narrow slice of Task fetched for the dashboard: the stats fields plus the
// keys needed for realtime merge and repo+issue dedup. Keep the column list
// below in sync with this type.
export type DashboardTask = Pick<
  Task,
  | 'id'
  | 'issue_url'
  | 'repo_owner'
  | 'repo_name'
  | 'issue_number'
  | 'status_group'
  | 'amount'
  | 'payment_date'
  | 'created_at'
>;

export const DASHBOARD_TASK_COLUMNS =
  'id, issue_url, repo_owner, repo_name, issue_number, status_group, amount, payment_date, created_at';

export interface CustomColumn {
  id: string;
  user_id: string;
  name: string;
  field_type: CustomFieldType;
  select_options: string[];
  position: number;
  created_at: string;
}

export interface CustomFieldValue {
  id: string;
  task_id: string;
  column_id: string;
  value: string | null;
}

export interface UserSettings {
  id: string;
  ai_api_key_encrypted: string | null;
  auto_sync_enabled: boolean;
  sync_interval_hours: number;
  github_token_encrypted: string | null;
  github_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  tasks_updated: number;
  error_message: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  github_username: string | null;
  github_access_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
}
