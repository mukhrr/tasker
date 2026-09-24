// What the drafter asks Jev, and the state it asks about. Pure, so it is
// testable without GitHub, Supabase or the network.
import { noulOf, choiceOf } from './jev.mjs';

const BODY_CAP = 1500;
const PROPOSAL_CAP = 4000;
const COMMENT_EXCERPT = 300;
const RECENT_COMMENTS = 6;

const isMelvin = (login) => /^melvin/i.test(login || '');

// Same match as the analyzer's findMelvinProposal.
export function findMelvinProposal(comments) {
  const hits = (comments || []).filter(
    (c) => isMelvin(c.user?.login) && /##\s*(Proposal|Issue Analysis)\b|What is the root cause/i.test(c.body || ''),
  );
  return hits.length ? hits[hits.length - 1].body : null;
}

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

export function issueState({ issue, comments, labels, trigger, lock, queuedAt, now = Date.now() }) {
  const melvin = findMelvinProposal(comments);
  const queued = Date.parse(queuedAt || '');
  return {
    title: issue.title,
    body: clip(issue.body, BODY_CAP),
    labels,
    help_wanted: labels.includes(trigger),
    external: labels.includes(lock),
    minutes_since_queued: Number.isFinite(queued) ? Math.round((now - queued) / 60_000) : null,
    melvin_proposal: melvin ? clip(melvin, PROPOSAL_CAP) : null,
    recent_comments: (comments || [])
      .filter((c) => c.body !== melvin)
      .slice(-RECENT_COMMENTS)
      .map((c) => ({ author: c.user?.login || '?', excerpt: clip(c.body, COMMENT_EXCERPT) })),
  };
}

const OPENS = {
  type: 'noul',
  instructions:
    'How likely is it that this Expensify/App issue gets the Help Wanted label and opens to outside contributors? ' +
    'It tends to stay closed when a C+ reviewer accepts MelvinBot\'s proposal and asks for a PR from it, when an ' +
    'Expensify employee says they will handle it, or when it is labelled Internal. It tends to open when a C+ or ' +
    'Expensify employee asks for proposals, or says MelvinBot\'s proposal is wrong or incomplete.',
};

const MELVIN_GAP = {
  type: 'noul',
  instructions:
    'How likely is it that melvin_proposal has a gap an outside contributor could win on: a vague or wrong root ' +
    'cause, deferring the fix to the backend, a missed platform or edge case, or no concrete code change? Judge the ' +
    'proposal itself. A reviewer approving it does not make it complete.',
};

// With no Melvin proposal there is nothing to beat, so the gap is total and the
// question is not worth a call.
export function draftGateQuestions(state) {
  return state.melvin_proposal ? { opens: OPENS, melvin_gap: MELVIN_GAP } : { opens: OPENS };
}

export function draftGateScores(state, answers) {
  const opens = noulOf(answers, 'opens');
  const gap = state.melvin_proposal ? noulOf(answers, 'melvin_gap') : 1;
  return { opens, melvin_gap: gap };
}

// Skip only when both are known and both are low. Missing a race costs more
// than a wasted draft, so any unknown drafts.
export function shouldSkipDraft({ opens, melvin_gap }, threshold) {
  if (opens === null || melvin_gap === null) return false;
  return opens < threshold && melvin_gap < threshold;
}

export const MELVIN_VERDICT_QUESTION = {
  verdict: {
    type: 'choice',
    instructions: 'Compare our_proposal with melvin_proposal for this issue and pick the verdict.',
    criteria: {
      BEATS:
        'Ours finds a genuinely different root cause, or a materially better fix for the same cause: correct where ' +
        "Melvin's is wrong, or concrete where Melvin's is vague or defers to the backend.",
      SAME:
        "Same root cause and essentially the same fix as Melvin's. Extra citations, a diff, git history or better " +
        'wording alone do not count as different.',
    },
  },
};

export function verdictState({ issue, melvin, ours }) {
  return {
    title: issue.title,
    body: clip(issue.body, BODY_CAP),
    melvin_proposal: clip(melvin, PROPOSAL_CAP),
    our_proposal: clip(ours, PROPOSAL_CAP),
  };
}

export function verdictFrom(answers) {
  return choiceOf(answers, 'verdict');
}

export const ANALYZE_QUESTION = {
  worth: {
    type: 'noul',
    instructions:
      'How likely is a full local reproduction and fix to be worth running for this issue? It is worth it when our ' +
      "proposal beats MelvinBot's and the bug looks reproducible in the web app. It is not when the fix is backend " +
      'only, needs a native device, or the issue is unlikely to open to contributors.',
  },
};
