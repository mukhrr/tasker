import type { TaskStatusGroup } from './types';

/** Hex color values for each named color (used instead of Tailwind classes) */
export const COLOR_HEX: Record<string, string> = {
  gray: '#6b7280',
  yellow: '#eab308',
  green: '#22c55e',
  red: '#ef4444',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  orange: '#f97316',
};

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
