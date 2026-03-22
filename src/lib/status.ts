import type { TaskStatusGroup, UserStatus } from '@/types/database';

export interface StatusColorConfig {
  dot: string;
  badge: string;
  rowBg: string;
}

export const STATUS_COLORS: Record<string, StatusColorConfig> = {
  gray: {
    dot: 'bg-gray-500',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    rowBg: 'bg-gray-500/8 dark:bg-gray-500/10',
  },
  yellow: {
    dot: 'bg-yellow-500',
    badge:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    rowBg: 'bg-yellow-500/8 dark:bg-yellow-500/10',
  },
  green: {
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    rowBg: 'bg-green-500/8 dark:bg-green-500/10',
  },
  red: {
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    rowBg: 'bg-red-500/8 dark:bg-red-500/10',
  },
  blue: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    rowBg: 'bg-blue-500/8 dark:bg-blue-500/10',
  },
  purple: {
    dot: 'bg-purple-500',
    badge:
      'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    rowBg: 'bg-purple-500/8 dark:bg-purple-500/10',
  },
  pink: {
    dot: 'bg-pink-500',
    badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
    rowBg: 'bg-pink-500/8 dark:bg-pink-500/10',
  },
  orange: {
    dot: 'bg-orange-500',
    badge:
      'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    rowBg: 'bg-orange-500/8 dark:bg-orange-500/10',
  },
};

export const COLOR_NAMES = Object.keys(STATUS_COLORS);

export const STATUS_GROUP_LABELS: Record<TaskStatusGroup, string> = {
  todo: 'To-do',
  in_progress: 'In Progress',
  complete: 'Complete',
};

export const STATUS_GROUP_ORDER: TaskStatusGroup[] = [
  'todo',
  'in_progress',
  'complete',
];

export function getStatusColor(colorName: string): StatusColorConfig {
  return STATUS_COLORS[colorName] ?? STATUS_COLORS.gray;
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** Returns a row background class if status hasn't changed for 3+ days */
export function getStaleRowBg(
  statuses: UserStatus[],
  statusKey: string,
  statusChangedAt: string | null | undefined
): string {
  if (!statusChangedAt) return '';
  const elapsed = Date.now() - new Date(statusChangedAt).getTime();
  if (elapsed < THREE_DAYS_MS) return '';
  const status = getStatusByKey(statuses, statusKey);
  if (!status) return '';
  return getStatusColor(status.color).rowBg;
}

export function getStatusByKey(
  statuses: UserStatus[],
  key: string
): UserStatus | undefined {
  return statuses.find((s) => s.key === key);
}

export function getStatusGroup(
  statuses: UserStatus[],
  statusKey: string
): TaskStatusGroup {
  const status = getStatusByKey(statuses, statusKey);
  return status?.group_name ?? 'todo';
}

export function getStatusesByGroup(
  statuses: UserStatus[]
): Record<TaskStatusGroup, UserStatus[]> {
  const groups: Record<TaskStatusGroup, UserStatus[]> = {
    todo: [],
    in_progress: [],
    complete: [],
  };
  for (const s of statuses) {
    groups[s.group_name]?.push(s);
  }
  // Sort by position within each group
  for (const group of STATUS_GROUP_ORDER) {
    groups[group].sort((a, b) => a.position - b.position);
  }
  return groups;
}
