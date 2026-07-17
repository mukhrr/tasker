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
  /** Each inner array is a set of labels that must all be present (AND).
   *  An issue matches if any group is satisfied (OR across groups). */
  watchedLabelGroups: string[][];
  excludedLabels: string[];
  /** Show the in-page lightning popup when a new Bug + Daily bounty appears. */
  bugDailyPopupEnabled: boolean;
  /** Play the attention chime when the lightning popup fires. */
  bugDailyPopupSound: boolean;
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

// `queued` and `drafting` are server-owned states created by the auto-draft
// pipeline (the sniper enqueues, the drafter fills). The extension treats them
// as read-only — it never authors or mutates a proposal in these states.
export type ProposalState =
  | 'queued'
  | 'drafting'
  | 'draft'
  | 'armed'
  | 'posting'
  | 'posted'
  | 'failed';

// States the extension must not overwrite: an in-flight server draft, or a row
// already claimed for / completed posting.
export const SERVER_OWNED_STATES: ReadonlySet<ProposalState> = new Set([
  'queued',
  'drafting',
  'posting',
  'posted',
]);

export interface Proposal {
  id: string;
  user_id: string;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  body: string;
  state: ProposalState;
  github_comment_id: number | null;
  last_error: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}
