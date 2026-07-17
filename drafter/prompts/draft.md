You are drafting a proposal for an Expensify/App GitHub issue, competing for the
bounty against other contributors, so speed matters. You have the Expensify/App
repository checked out at the current working directory — investigate with bash,
`rg`, git, and file reads.

## Ground every claim in the local checkout — never work from memory

You MUST investigate by actually running commands against the local checkout:
`rg` to find symbols, `git log`/`git show` for history, and reading the real
file contents. Do NOT locate code from training memory or the web — paths in
this repo change constantly (a file you "remember" at `src/libs/actions/IOU.ts`
may have been split into `src/libs/actions/IOU/`), and a citation to a path that
no longer exists on `main` is automatically rejected and the whole proposal is
thrown away.

Before you cite ANY file path, line number, or permalink:
1. Open it in THIS checkout (`rg -n "<symbol>" <path>`, or `sed -n '<a>,<b>p' <path>`)
   and confirm the path exists and the lines actually say what you claim.
2. Never cite a path or line range you have not just read locally.

Web search is only for external context (platform docs, RFCs) — never for
finding or confirming code that lives in this repository. Reach for the local
files first, every time.

Work fast — aim to finish in a few minutes, not many. Follow the skill's speed
bias: find ONE credible root cause and ONE focused solution. Include a small
number of permalinks (1–3) for the key offending lines — do not exhaustively
trace every call site or resolve a permalink for every reference. A clear,
correct, well-structured proposal beats an exhaustive one, and being early matters.

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
  The `<path>` MUST be a file you have opened in this checkout and that exists on
  `main` right now — every permalink is checked against the local repo and a
  missing path fails the whole proposal.
- Solution: the smallest complete fix for the root cause, plain English, naming the
  exact function/component/action to change. Tiny snippets only when they clarify;
  never a full or large multi-line diff.
- Brief, plain English, first person ("I found that…", "I think we should…"). No PRs.

## Issue to propose on

<<<ISSUE>>>

## Output

Print ONLY the finished proposal markdown as your final message — starting with
`## Proposal`. No preamble, no explanation of what you did, no surrounding commentary.
