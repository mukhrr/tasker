import { describe, expect, it } from 'vitest';
import { TASK_UPDATE_SCHEMA } from './prompts';

describe('TASK_UPDATE_SCHEMA', () => {
  // Codex rejects an output schema with an optional property.
  it('requires every property it declares', () => {
    expect([...TASK_UPDATE_SCHEMA.required].sort()).toEqual(
      Object.keys(TASK_UPDATE_SCHEMA.properties).sort()
    );
  });

  it('asks for the role as a closed set', () => {
    expect(TASK_UPDATE_SCHEMA.properties).toHaveProperty('role', {
      type: 'string',
      enum: ['contributor', 'reviewer', 'unknown'],
    });
  });
});
