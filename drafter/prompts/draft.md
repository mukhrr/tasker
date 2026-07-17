You are drafting a proposal for an Expensify/App GitHub issue, competing for the
bounty against other contributors, so speed matters. You have the Expensify/App
repository checked out at the current working directory — investigate with bash,
`rg`, git, and file reads.

Follow the **expensify-proposal-writer** skill exactly. Read these files first and
apply them as your instructions and rubric:

- `<<<SKILL_DIR>>>/SKILL.md`
- `<<<SKILL_DIR>>>/references/proposal-rubric.md`

Also read `contributingGuides/PROPOSAL_TEMPLATE.md` from the checkout and use its
exact required sections as the output structure.

Key rules from the skill (do not violate):
- Structure: `## Proposal` then `### What is the root cause of that problem?`,
  `### What changes do you think we should make in order to solve the problem?`,
  and an optional `### What alternative solutions did you explore? (Optional)`.
- Root cause: specific and evidence-backed, with a GitHub permalink to the exact
  offending lines. Pin permalinks to a commit SHA on `main` (run
  `git fetch origin main --quiet && git rev-parse origin/main`, then format as
  `https://github.com/Expensify/App/blob/<sha>/<path>#L<start>-L<end>`); a branch
  ref like `blob/main/...` will not preview on GitHub. Link exact line ranges.
- Solution: the smallest complete fix for the root cause, plain English, naming the
  exact function/component/action to change. Tiny snippets only when they clarify;
  never a full or large multi-line diff.
- Brief, plain English, first person ("I found that…", "I think we should…"). No PRs.

## Issue to propose on

<<<ISSUE>>>

## Output

Print ONLY the finished proposal markdown as your final message — starting with
`## Proposal`. No preamble, no explanation of what you did, no surrounding commentary.
