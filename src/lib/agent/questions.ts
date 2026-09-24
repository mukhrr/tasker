import type { JevQuestion } from './jev';
import type { UserStatus } from '@/types/database';

export const MAX_CHOICE_OPTIONS = 255;

export function statusCriteria(
  statuses: UserStatus[]
): Record<string, string | null> {
  const criteria: Record<string, string | null> = {};
  for (const status of statuses.slice(0, MAX_CHOICE_OPTIONS)) {
    const description = status.description?.trim();
    criteria[status.key] = description ? description : null;
  }
  return criteria;
}

// A null criterion is legal but guesses; Settings should make descriptions
// mandatory, and until then the caller logs these.
export function statusesMissingDescriptions(statuses: UserStatus[]): string[] {
  return statuses.filter((s) => !s.description?.trim()).map((s) => s.key);
}

export function statusChoiceQuestion(statuses: UserStatus[]): JevQuestion {
  return {
    type: 'choice',
    instructions:
      'Pick the status that matches this task now. Each option describes when it applies. Use the Computed Facts as given; do not re-derive them.',
    criteria: statusCriteria(statuses),
  };
}

export function materialChangeQuestion(): JevQuestion {
  return {
    type: 'noul',
    instructions:
      'Could anything listed here change the task status, the pull request, the bounty amount, or the payment state? Routine bot comments, reminders and label churn are not changes.',
  };
}
