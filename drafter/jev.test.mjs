import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typesafeJevDecider, deciderFromEnv, jevModeFromEnv, noulOf, choiceOf } from './jev.mjs';
import { issueState, draftGateQuestions, draftGateScores, shouldSkipDraft, findMelvinProposal } from './decisions.mjs';

const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

test('posts model, state and questions to TypeSafe with a bearer key', async () => {
  let call;
  const decide = typesafeJevDecider('k', { fetchImpl: (url, init) => ((call = { url, init }), ok({ answers: {} })) });
  await decide({ a: 1 }, { q: { type: 'noul', instructions: 'x' } });
  assert.equal(call.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(call.init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(call.init.body), { model: 'jev-latest', state: { a: 1 }, questions: { q: { type: 'noul', instructions: 'x' } } });
});

test('resolves null on a non-200 or a thrown fetch', async () => {
  const bad = typesafeJevDecider('k', { fetchImpl: () => Promise.resolve(new Response('no', { status: 403 })) });
  assert.equal(await bad({}, {}), null);
  const down = typesafeJevDecider('k', { fetchImpl: () => Promise.reject(new TypeError('fetch failed')) });
  assert.equal(await down({}, {}), null);
});

test('mode defaults to off and needs credentials to decide', () => {
  assert.equal(jevModeFromEnv({}), 'off');
  assert.equal(jevModeFromEnv({ JEV_MODE: 'shadow' }), 'shadow');
  assert.equal(deciderFromEnv({ JEV_MODE: 'on' }), null);
  assert.equal(typeof deciderFromEnv({ TYPESAFE_API_KEY: 'k' }), 'function');
});

test('reads noul and choice answers', () => {
  const answers = {
    opens: { type: 'noul', noul: 0.2 },
    verdict: { type: 'choice', choice: 'SAME', probabilities: { SAME: 0.8 }, confidence: 0.6 },
  };
  assert.equal(noulOf(answers, 'opens'), 0.2);
  assert.equal(noulOf(answers, 'missing'), null);
  assert.deepEqual(choiceOf(answers, 'verdict'), { choice: 'SAME', confidence: 0.8 });
});

const melvinComment = { user: { login: 'MelvinBot' }, body: '## Proposal\nWhat is the root cause ...' };
const issue = { title: 'Receipt missing', body: 'Steps...' };

test('finds MelvinBot proposals only', () => {
  assert.equal(findMelvinProposal([{ user: { login: 'melvin-bot[bot]' }, body: 'Triggered auto assignment' }]), null);
  assert.equal(findMelvinProposal([melvinComment]), melvinComment.body);
});

test('asks about a Melvin gap only when Melvin posted', () => {
  const base = { issue, labels: ['External'], trigger: 'help wanted', lock: 'external', queuedAt: null };
  const without = issueState({ ...base, comments: [] });
  assert.deepEqual(Object.keys(draftGateQuestions(without)), ['opens']);
  assert.equal(draftGateScores(without, { opens: { type: 'noul', noul: 0.1 } }).melvin_gap, 1);
  const withMelvin = issueState({ ...base, labels: ['external'], comments: [melvinComment] });
  assert.equal(withMelvin.external, true);
  assert.deepEqual(Object.keys(draftGateQuestions(withMelvin)), ['opens', 'melvin_gap']);
  assert.equal(withMelvin.recent_comments.length, 0);
});

test('skips a draft only when both scores are known and low', () => {
  assert.equal(shouldSkipDraft({ opens: 0.1, melvin_gap: 0.1 }, 0.3), true);
  assert.equal(shouldSkipDraft({ opens: 0.1, melvin_gap: 0.6 }, 0.3), false);
  assert.equal(shouldSkipDraft({ opens: 0.9, melvin_gap: 0.1 }, 0.3), false);
  assert.equal(shouldSkipDraft({ opens: null, melvin_gap: 0.1 }, 0.3), false);
});
