export type BountyStatusTodo =
  | 'in_proposal'
  | 'promising'
  | 'got_cplus'
  | 'update_proposal';

export type BountyStatusInProgress =
  | 'assigned'
  | 'reviewing'
  | 'changes_required'
  | 'awaiting_payment'
  | 'merged';

export type BountyStatusComplete = 'regression' | 'paid' | 'wasted';

export type BountyStatus =
  | BountyStatusTodo
  | BountyStatusInProgress
  | BountyStatusComplete;

export type BountyStatusGroup = 'todo' | 'in_progress' | 'complete';

export type CustomFieldType = 'text' | 'date' | 'number' | 'url' | 'select';

export interface Bounty {
  id: string;
  user_id: string;
  issue_url: string;
  pr_url: string | null;
  status: BountyStatus;
  status_group: BountyStatusGroup;
  amount: number | null;
  payment_date: string | null;
  assigned_date: string | null;
  note: string | null;
  ai_summary: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  issue_number: number | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

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
  bounty_id: string;
  column_id: string;
  value: string | null;
}

export interface UserSettings {
  id: string;
  ai_api_key_encrypted: string | null;
  auto_sync_enabled: boolean;
  sync_interval_hours: number;
  github_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  bounties_updated: number;
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
