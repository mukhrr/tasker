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

export type NotifyChannel = 'browser' | 'telegram';

export interface ExtensionSettings {
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  notifyHelpWanted: boolean;
  notifyChannels: NotifyChannel[];
  telegramChatId: string;
  telegramTokenSaved: boolean;
  pollSeconds: number;
  watchedLabels: string[];
  excludedLabels: string[];
}

export interface HelpWantedIssue {
  number: number;
  title: string;
  url: string;
  labels: string[];
}

export interface WatchlistEntry {
  owner: string;
  repo: string;
}

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
  created_at: string;
  updated_at: string;
}
