export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  body: string | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: GitHubUser;
  merged: boolean;
  merged_at: string | null;
  draft: boolean;
  review_comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  body: string | null;
}

export interface GitHubComment {
  id: number;
  user: GitHubUser;
  body: string;
  created_at: string;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  body: string | null;
  submitted_at: string;
}

export interface GitHubEvent {
  id: number;
  event: string;
  actor: GitHubUser;
  created_at: string;
  assignee?: GitHubUser;
}
