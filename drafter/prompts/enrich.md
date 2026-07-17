You previously drafted the proposal below for this Expensify/App issue. Now
strengthen it into a proposal that would win C+ selection. You have the repository
checked out at the current working directory — investigate with bash, grep, git log,
and file reads.

Improve it on these axes, keeping the SAME three-section template structure and all
the hard rules from the original draft (SHA-pinned permalinks, no full diffs, first-person
plain English, minimal `+`/`-` sketches only):

1. **Stronger root cause** — trace the actual offending code, don't hand-wave. Confirm the
   permalinks point at the right lines on the current `origin/main` SHA.
2. **Similar cases + git history** — search for prior fixes to related bugs (`git log`,
   grep for the component/regressions). If a past PR or commit is relevant, cite it. This
   shows the reviewer you understand the area.
3. **Regression safety** — explicitly note why the proposed change won't break adjacent
   behavior (other call sites, platforms, edge cases). Reviewers reward this.
4. **A minimal, precise sketch** — where a tiny `+`/`-` sketch (a handful of lines, only the
   essential change) makes the fix unambiguous, include one. Keep it minimal — never a full
   patch. Skip it if prose is already clear.

## Current proposal to improve

<<<CURRENT_PROPOSAL>>>

## Output

Print ONLY the improved proposal markdown as your final message — starting with
`## Proposal`. No preamble, no notes about what you changed.
