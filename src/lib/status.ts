import type { BountyStatus, BountyStatusGroup } from '@/types/database';

export interface StatusConfig {
  label: string;
  color: string;
  dotColor: string;
  group: BountyStatusGroup;
}

export const STATUS_CONFIG: Record<BountyStatus, StatusConfig> = {
  // To-do
  in_proposal: {
    label: 'In Proposal',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dotColor: 'bg-gray-500',
    group: 'todo',
  },
  promising: {
    label: 'Promising',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    dotColor: 'bg-yellow-500',
    group: 'todo',
  },
  got_cplus: {
    label: 'Got C+',
    color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    dotColor: 'bg-green-500',
    group: 'todo',
  },
  update_proposal: {
    label: 'Update Proposal',
    color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    dotColor: 'bg-red-500',
    group: 'todo',
  },
  // In progress
  assigned: {
    label: 'Assigned',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    dotColor: 'bg-blue-500',
    group: 'in_progress',
  },
  reviewing: {
    label: 'Reviewing',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    dotColor: 'bg-purple-500',
    group: 'in_progress',
  },
  changes_required: {
    label: 'Changes Required',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    dotColor: 'bg-orange-500',
    group: 'in_progress',
  },
  awaiting_payment: {
    label: 'Awaiting Payment',
    color: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
    dotColor: 'bg-pink-500',
    group: 'in_progress',
  },
  merged: {
    label: 'Merged',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dotColor: 'bg-gray-500',
    group: 'in_progress',
  },
  // Complete
  regression: {
    label: 'Regression',
    color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    dotColor: 'bg-red-500',
    group: 'complete',
  },
  paid: {
    label: 'Paid',
    color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    dotColor: 'bg-green-500',
    group: 'complete',
  },
  wasted: {
    label: 'Wasted',
    color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    dotColor: 'bg-red-500',
    group: 'complete',
  },
};

export const STATUS_GROUPS: Record<BountyStatusGroup, BountyStatus[]> = {
  todo: ['in_proposal', 'promising', 'got_cplus', 'update_proposal'],
  in_progress: ['assigned', 'reviewing', 'changes_required', 'awaiting_payment', 'merged'],
  complete: ['regression', 'paid', 'wasted'],
};

export const ALL_STATUSES = Object.keys(STATUS_CONFIG) as BountyStatus[];

export const STATUS_GROUP_LABELS: Record<BountyStatusGroup, string> = {
  todo: 'To-do',
  in_progress: 'In Progress',
  complete: 'Complete',
};
