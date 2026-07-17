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

// Manual "Post now" asks the background to claim the proposal and post it.
export interface PostProposalNowRequest {
  type: 'POST_PROPOSAL_NOW';
  proposalId: string;
  // Required for the explicit manual flow. Calls without it are rejected so
  // older content scripts cannot invoke the retired automatic fast path.
  force?: boolean;
}

export interface GetAutoPostRequest {
  type: 'GET_AUTOPOST';
}

export interface SetAutoPostRequest {
  type: 'SET_AUTOPOST';
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
  | PostProposalNowRequest
  | GetAutoPostRequest
  | SetAutoPostRequest
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
