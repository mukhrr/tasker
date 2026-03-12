import type { TaskStatusGroup, UserStatus } from '@/types/database';

export interface StatusColorConfig {
  dot: string;
  badge: string;
}

export const STATUS_COLORS: Record<string, StatusColorConfig> = {
  gray: {
    dot: 'bg-gray-500',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  yellow: {
    dot: 'bg-yellow-500',
    badge:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  },
  green: {
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  red: {
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  },
  blue: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  purple: {
    dot: 'bg-purple-500',
    badge:
      'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  },
  pink: {
    dot: 'bg-pink-500',
    badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  },
  orange: {
    dot: 'bg-orange-500',
    badge:
      'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
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
