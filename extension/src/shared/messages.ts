import type { Task, UserStatus, WatchedLabel } from './types';

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
  labels: WatchedLabel[];
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
  | TestNotificationRequest;

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
