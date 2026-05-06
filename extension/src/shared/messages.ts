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

// Tab-side fast-path: content script asks the background to claim the
// armed proposal and post the comment immediately, without waiting on
// the cloud worker's poll cycle.
export interface PostProposalNowRequest {
  type: 'POST_PROPOSAL_NOW';
  proposalId: string;
  // When true: bypass the auto-post kill switch and allow the row to
  // transition to 'posting' from any non-terminal state (draft, armed,
  // failed). This is for the manual "Post now" button — explicit user
  // intent overrides the master toggle.
  force?: boolean;
}

// ETag-cached labels query — content script polls this every ~1.5s while
// the issue tab is visible. 304 responses cost no GitHub rate-limit quota,
// so the loop is essentially free.
export interface QueryIssueLabelsEtagRequest {
  type: 'QUERY_ISSUE_LABELS_ETAG';
  owner: string;
  repo: string;
  number: number;
  etag: string | null;
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
  | QueryIssueLabelsRequest
  | QueryProposalRequest
  | SaveProposalRequest
  | ArmProposalRequest
  | DisarmProposalRequest
  | PostProposalNowRequest
  | QueryIssueLabelsEtagRequest
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

export interface IssueLabelsEtagData {
  etag: string | null;
  labels: string[] | null;
  notModified: boolean;
}
export type IssueLabelsEtagResponse = MessageResponse<IssueLabelsEtagData>;
export type AutoPostResponse = MessageResponse<{ enabled: boolean }>;
