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

## Make the proposal deep and defensible — this is the one and only pass

Do not settle for the first idea. This single pass must be thorough, so invest in
the investigation using the local checkout:
- **Root cause:** find WHY the code is wrong and how it got that way. Read the
  offending code, then use `git log` / `git blame` / `git show` on those exact
  lines to check the **history** — was the bug introduced by a recent change, did
  a prior PR try to fix something related, is there a regression? Search for
  **similar cases** (`rg` for the same pattern / function / component elsewhere)
  and note whether they share or avoid the bug. Attach a SHA-pinned **permalink**
  for each piece of evidence — as a **bare URL on its own line** (see Permalink
  formatting below) so GitHub renders the code-snippet preview.
- **Solution:** name the exact function/component/action to change and give the
  smallest complete fix. Include a **small illustrative code diff** (a few lines
  of before/after — never a full patch or a reproduced function) so the reviewer
  sees the change concretely. Explicitly explain why it does **not cause a
  regression**: which existing callers/behaviors stay correct, and whether the
  similar cases you found are unaffected or also need the fix.

Take the time to get this right rather than racing — but stay grounded in files
you have actually read. A wrong-but-fast proposal loses the bounty anyway.

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
- **Permalink formatting (important):** write every permalink as a **bare URL on
  its own line** — nothing else on that line, with a blank line before and after.
  Do NOT wrap it in a `[label](url)` markdown link and do NOT bury it inline inside
  a sentence. GitHub only expands a permalink into the rich code-snippet PREVIEW
  when the URL stands alone on its own line. End your sentence, then put the bare
  URL on the next line. For example, write it like this:

  `` It only considers `IOU` actions whose type is `PAY`: ``
  (blank line)
  `https://github.com/Expensify/App/blob/<sha>/src/libs/ReportSecondaryActionUtils.ts#L419-L432`
  (blank line, then continue the next sentence)

  — NOT inline as `([filter](https://github.com/.../L419-L432))`.
- Solution: the smallest complete fix for the root cause, plain English, naming the
  exact function/component/action to change. Include a small, illustrative code diff
  (a few lines showing the change) and state why it avoids regressions. Keep diffs
  small and explanatory — never a full patch or a reproduced function.
- Brief, plain English, first person ("I found that…", "I think we should…"). No PRs.

## Issue to propose on

<<<ISSUE>>>

## Output

Print ONLY the finished proposal markdown as your final message — starting with
`## Proposal`. No preamble, no explanation of what you did, no surrounding commentary.
