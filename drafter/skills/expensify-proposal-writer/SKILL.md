---
name: expensify-proposal-writer
description: Draft and revise Expensify/App issue proposals quickly using contributingGuides/PROPOSAL_TEMPLATE.md. Use when the user provides an Expensify issue link, issue body, root-cause notes, reproduction details, RCA evidence, code permalinks, or asks for help writing a proposal, problem statement, root cause, solution, alternatives, or Strategy/Problem/Solution post for an Expensify open-source issue, especially when competing contributors make speed important.
---

# Expensify Proposal Writer

## Workflow

1. Load the issue context from the provided GitHub issue URL or issue body. If a URL is provided and GitHub access is available, fetch the issue title, body, labels, linked comments, and any reproduction steps.
2. Read `contributingGuides/PROPOSAL_TEMPLATE.md` from the current Expensify/App checkout when available. Use its exact required sections as the output structure.
3. Read `references/proposal-rubric.md` before drafting or reviewing the proposal.
4. Identify the measurable problem first. Use the format: `Problem: When X happens, it causes Y, which prevents us from Z.`
5. Establish the root cause with evidence from code, logs, reproduction behavior, or issue screenshots. Include permalinks for RCA when possible.
6. Propose the smallest complete solution that fixes the root cause. Plain English is preferred; include short pseudo-code or tiny diff excerpts only when they make the solution easier to evaluate.
7. Add alternatives only when they are meaningfully different and explain why they are less suitable.

## Speed Bias

- Prioritize a good, reviewable first proposal over exhaustive analysis because Expensify issues often have competing contributors.
- Timebox exploration: use the issue body, reproduction steps, obvious code paths, and targeted `rg` searches first.
- Draft as soon as the root cause is credible. Mark assumptions clearly instead of delaying for perfect certainty.
- Avoid broad repo spelunking unless the first-pass RCA is weak or the issue touches a risky shared flow.
- Prefer one strong root-cause explanation and one focused solution over several speculative options.

## Output Rules

- Keep the proposal brief, plain-English, and easy for a Contributor+ to review.
- Do not post large multi-line diffs. Small focused snippets are acceptable only as explanation.
- Do not suggest creating a PR unless the user has already been hired for the job.
- Do not make the problem statement a reverse solution statement.
- Do not claim a measurable impact unless the issue evidence supports it.
- If the issue is really a new product/process idea rather than a bug/job proposal, format it for `#expensify-open-source` using `Strategy` / `Problem` / `Solution`.

## How it reads (anti-tells)

The C+ reads dozens of model-written proposals a day and pattern-matches the
sheen. Kill it:

- Vary the rhythm. A short sentence, then a longer one. A fragment is fine.
  Four bullets of identical length in perfect parallel is the loudest tell
  there is.
- No bold on single words for emphasis (never "renders **no** code row"). If a
  word needs bold to carry the point, rewrite the sentence. Headings carry
  their own weight.
- No em dashes. Use a comma, a colon, or a new sentence.
- Banned constructions: "This is X, not Y", "not just X, it's Y", "crucially",
  "importantly", "note that", "in other words", "simply", "essentially".
- Inline code for real identifiers only, at most two per sentence. If a
  sentence needs more, split it or move the detail into a snippet.
- Prose first. A bullet list only when the content is genuinely a list, and
  one list per proposal is usually enough.
- First person, past tense for what you did and saw: "I put the workspace in
  that state and the row never renders."
- Do not sand every sentence smooth. A slightly unpolished line reads like an
  engineer; uniform polish reads like a model.

## Expected Shape

```markdown
## Proposal

### What is the root cause of that problem?

[Concise root cause with evidence and permalinks.]

### What changes do you think we should make in order to solve the problem?

[Small complete solution, focused on the root cause.]

### What alternative solutions did you explore? (Optional)

[Only meaningful alternatives.]
```

If the user asks for a full problem framing before the template, include a short `Problem:` line above `## Proposal`.
