import type { Task, UserStatus, Proposal } from './types';

// ── Request types ──

export interface LoginGithubRequest {
  type: 'LOGIN_GITHUB';
}

export interface LogoutRequest {
  type: 'LOGOUT';
}

export interface GetSessionRequest {
  type: 'GET_SESSION';
}

export interface QueryTaskRequest {
  type: 'QUERY_TASK';
  owner: string;
  repo: string;
  number: number;
}

export interface QueryStatusesRequest {
  type: 'QUERY_STATUSES';
}

export interface UpdateStatusRequest {
  type: 'UPDATE_STATUS';
  taskId: string;
  status: string;
  statusGroup: string;
}

export interface CreateTaskRequest {
  type: 'CREATE_TASK';
  owner: string;
  repo: string;
  number: number;
}

export interface QueryTasksBatchRequest {
  type: 'QUERY_TASKS_BATCH';
  owner: string;
  repo: string;
  issueNumbers: number[];
}

export interface UpdateLinkedStatusesRequest {
  type: 'UPDATE_LINKED_STATUSES';
  owner: string;
  repo: string;
  issueNumbers: number[];
  status: string;
  statusGroup: string;
}

export interface SendHelpWantedNotificationRequest {
  type: 'SEND_HELP_WANTED';
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
}

export interface TestTelegramRequest {
  type: 'TEST_TELEGRAM';
  token: string;
  chatId: string;
}

export interface TestBrowserNotificationRequest {
  type: 'TEST_BROWSER_NOTIFICATION';
}

export interface ReschedulePollerRequest {
  type: 'RESCHEDULE_POLLER';
}

export interface TestNotificationRequest {
  type: 'TEST_NOTIFICATION';
}

export interface TestBugDailyAlertRequest {
  type: 'TEST_BUG_DAILY_ALERT';
  sound: boolean;
}

export interface QueryIssueLabelsRequest {
  type: 'QUERY_ISSUE_LABELS';
  owner: string;
  repo: string;
  number: number;
}

export interface QueryProposalRequest {
  type: 'QUERY_PROPOSAL';
  owner: string;
  repo: string;
  number: number;
}

export interface SaveProposalRequest {
  type: 'SAVE_PROPOSAL';
  owner: string;
  repo: string;
  number: number;
  body: string;
}

export interface ArmProposalRequest {
  type: 'ARM_PROPOSAL';
  owner: string;
  repo: string;
  number: number;
}

export interface DisarmProposalRequest {
  type: 'DISARM_PROPOSAL';
  owner: string;
  repo: string;
  number: number;
}

// "Run Auto-pilot" enqueues this issue for the server-side drafter (Codex writes
// the proposal, validates it, and arms it). Creates/sets a proposals row to
// state='queued', origin='auto' regardless of whether the issue is in a watched
// label group — this is the manual, per-issue trigger for the auto-draft flow.
export interface EnqueueAutoDraftRequest {
  type: 'ENQUEUE_AUTO_DRAFT';
  owner: string;
  repo: string;
  number: number;
}

// Cancel an in-flight auto-draft: returns a queued/drafting row to a plain
// manual 'draft' so the drafter stops working on it (its arm is state-filtered,
// so a mid-flight cancel is honored).
export interface CancelAutoDraftRequest {
  type: 'CANCEL_AUTO_DRAFT';
  owner: string;
  repo: string;
  number: number;
}

// "Clear draft" deletes the proposals row from the DB so the widget returns to
// its empty state. Refused while the server is mid-flight (drafting/posting) to
// avoid racing the worker; cancel an auto-draft first.
export interface ClearProposalRequest {
  type: 'CLEAR_PROPOSAL';
  owner: string;
  repo: string;
  number: number;
}

// Manual "Post now" asks the background to claim the proposal and post it.
export interface PostProposalNowRequest {
  type: 'POST_PROPOSAL_NOW';
  proposalId: string;
  // Required for the explicit manual flow. Calls without it are rejected so
  // older content scripts cannot invoke the retired automatic fast path.
  force?: boolean;
}

// Sync the extension's watched label groups + excluded labels to Supabase so the
// server-side sniper queues auto-drafts by the same config the user edits here.
export interface SyncLabelConfigRequest {
  type: 'SYNC_LABEL_CONFIG';
  watchedLabelGroups: string[][];
  excludedLabels: string[];
}

export interface GetAutoPostRequest {
  type: 'GET_AUTOPOST';
}

export interface SetAutoPostRequest {
  type: 'SET_AUTOPOST';
  enabled: boolean;
}

// Auto-pilot master switch — controls the server-side drafter (auto-drafting),
// mirrored to user_settings.autopilot_enabled. Independent of auto-post.
export interface GetAutoPilotRequest {
  type: 'GET_AUTOPILOT';
}

export interface SetAutoPilotRequest {
  type: 'SET_AUTOPILOT';
  enabled: boolean;
}

// Verify that a 'posted' proposal's comment still exists on GitHub.
// If GitHub returns 404 (comment deleted), the row is reverted to 'draft'
// so the user can re-edit and repost. Body is preserved.
export interface VerifyPostedCommentRequest {
  type: 'VERIFY_POSTED_COMMENT';
  proposalId: string;
}

export type MessageRequest =
  | LoginGithubRequest
  | LogoutRequest
  | GetSessionRequest
  | QueryTaskRequest
  | QueryStatusesRequest
  | UpdateStatusRequest
  | CreateTaskRequest
  | QueryTasksBatchRequest
  | UpdateLinkedStatusesRequest
  | SendHelpWantedNotificationRequest
  | TestTelegramRequest
  | TestBrowserNotificationRequest
  | ReschedulePollerRequest
  | TestNotificationRequest
  | TestBugDailyAlertRequest
  | QueryIssueLabelsRequest
  | QueryProposalRequest
  | SaveProposalRequest
  | ArmProposalRequest
  | DisarmProposalRequest
  | EnqueueAutoDraftRequest
  | CancelAutoDraftRequest
  | ClearProposalRequest
  | SyncLabelConfigRequest
  | PostProposalNowRequest
  | GetAutoPostRequest
  | SetAutoPostRequest
  | GetAutoPilotRequest
  | SetAutoPilotRequest
  | VerifyPostedCommentRequest;

// ── Response types ──

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface SessionData {
  userId: string;
  email: string;
  username: string;
}

export type LoginResponse = MessageResponse<SessionData>;
export type SessionResponse = MessageResponse<SessionData | null>;
export type TaskResponse = MessageResponse<Task | null>;
export type StatusesResponse = MessageResponse<UserStatus[]>;
export type UpdateResponse = MessageResponse<void>;
export type CreateTaskResponse = MessageResponse<Task>;
export type TasksBatchResponse = MessageResponse<Task[]>;
export type IssueLabelsResponse = MessageResponse<string[]>;
export type ProposalResponse = MessageResponse<Proposal | null>;

export type AutoPostResponse = MessageResponse<{ enabled: boolean }>;
