import { describe, expect, it } from 'vitest';
import { TASK_UPDATE_SCHEMA, buildAnalysisPrompt } from './prompts';

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

describe('buildAnalysisPrompt review turn', () => {
  const base = {
    currentStatus: 'review_due',
    isFirstSync: false,
    githubUsername: 'mukhrr',
    asReviewer: true,
  };

  it("states the author's move when nothing came after my review", () => {
    expect(buildAnalysisPrompt({ ...base, reviewTurn: 'author' })).toContain(
      "Whose move on the PR: **the PR author's**"
    );
  });

  it("states the developer's move after the author pushed", () => {
    expect(buildAnalysisPrompt({ ...base, reviewTurn: 'me' })).toContain(
      "Whose move on the PR: **the developer's**"
    );
  });

  it('says nothing without a computed turn', () => {
    expect(buildAnalysisPrompt(base)).not.toContain('Whose move');
  });
});
