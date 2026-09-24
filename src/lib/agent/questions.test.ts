import { describe, it, expect } from 'vitest';
import {
  statusCriteria,
  statusChoiceQuestion,
  materialChangeQuestion,
  statusesMissingDescriptions,
  MAX_CHOICE_OPTIONS,
} from './questions';
import type { UserStatus } from '@/types/database';

function status(
  key: string,
  description: string,
  group: UserStatus['group_name'] = 'todo'
): UserStatus {
  return {
    id: key,
    user_id: 'u',
    key,
    label: key,
    description,
    color: 'gray',
    group_name: group,
    position: 0,
    created_at: '',
  };
}

describe('statusCriteria', () => {
  it('maps each status key to its description', () => {
    expect(statusCriteria([status('merged', 'PR has been merged')])).toEqual({
      merged: 'PR has been merged',
    });
  });

  it('sends null for a status with no description', () => {
    expect(statusCriteria([status('hold', '')])).toEqual({ hold: null });
  });

  it('caps the option count at the API maximum', () => {
    const many = Array.from({ length: MAX_CHOICE_OPTIONS + 10 }, (_, i) =>
      status(`s${i}`, 'd')
    );
    expect(Object.keys(statusCriteria(many))).toHaveLength(MAX_CHOICE_OPTIONS);
  });
});

describe('statusesMissingDescriptions', () => {
  it('names the statuses that would be sent as null', () => {
    expect(
      statusesMissingDescriptions([
        status('merged', 'PR merged'),
        status('hold', '  '),
      ])
    ).toEqual(['hold']);
  });
});

describe('statusChoiceQuestion', () => {
  it('builds a choice carrying the criteria', () => {
    const q = statusChoiceQuestion([status('merged', 'PR has been merged')]);
    expect(q.type).toBe('choice');
    if (q.type !== 'choice') throw new Error('expected a choice');
    expect(q.criteria).toEqual({ merged: 'PR has been merged' });
    expect(q.instructions).toContain('status');
  });
});

describe('materialChangeQuestion', () => {
  it('is a noul', () => {
    expect(materialChangeQuestion().type).toBe('noul');
  });
});
