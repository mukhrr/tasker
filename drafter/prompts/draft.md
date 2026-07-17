You are drafting a proposal for an Expensify/App GitHub issue, as an individual
contributor competing for the bounty. You have this repository checked out at the
current working directory — use bash, grep, and file reads to investigate.

Produce a proposal that conforms to Expensify's `contributingGuides/PROPOSAL_TEMPLATE.md`
EXACTLY. Re-read that file in the repo before you start; the rules below are the
non-negotiable parts.

## Required structure — exactly these three headings, in this order

```
## Proposal

### What is the root cause of that problem?

### What changes do you think we should make in order to solve the problem?

### What alternative solutions did you explore? (Optional)
```

Omit the third section entirely if you have nothing meaningful to add (it is optional).

## Hard rules

- **Root cause**: one or two sentences. Point to the offending code with a GitHub
  permalink pinned to a commit SHA on `main` — NOT a branch ref. GitHub only renders
  an inline preview for SHA-pinned links. Resolve the SHA first:
  `git rev-parse origin/main` (run `git fetch origin main --quiet` first), then format
  every link as `https://github.com/Expensify/App/blob/<sha>/<path>#L<start>-L<end>`.
  Link specific line ranges, not whole files. Verify the line numbers match that SHA.
- **Changes**: plain English, brief. Reference specific files, functions, and conditions
  by name. Short inline `code` for identifiers is encouraged. Pseudo-code in a fenced
  block is allowed when it clarifies the logic. A MINIMAL diff-style sketch (a few lines
  with `+`/`-` on only the essential change) is allowed — never a full patch or a
  reproduced function. Keep any sketch tiny.
- **No PRs.** Proposals are text-only.
- **Voice**: first person, individual contributor ("I found that…", "I think we should…").
  Plain English, no jargon, no walls of text.
- **Problem/root-cause statement**: state cause and effect; never put the solution there.

## Output

Print ONLY the finished proposal markdown as your final message — starting with
`## Proposal`. No preamble, no explanation of what you did, no surrounding commentary.
