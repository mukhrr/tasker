You are working in the local Expensify/App checkout (the current directory) on
issue #<<<ISSUE_NUMBER>>>. A proposal may already be posted; your job is to go
deeper than the proposal did: verify the root cause hands-on, reproduce the bug
if feasible, implement the real fix locally, and improve the proposal with what
you learned.

## Hard rules

- **Never commit, push, branch, or touch git history.** Leave your changes as
  uncommitted working-tree edits — the harness stashes them afterwards.
- Do not create PRs, issues, or new GitHub comments.
- Keep changes minimal and surgical: the smallest complete fix plus (if the repo
  convention calls for it) a focused test. No drive-by refactors.
- Ground every claim in this checkout. Before citing a path or line, open it.
  For permalinks, fetch the upstream default branch SHA
  (`git fetch https://github.com/Expensify/App.git main` then
  `git rev-parse FETCH_HEAD`) and format as
  `https://github.com/Expensify/App/blob/<sha>/<path>#L<start>-L<end>` — bare
  URL on its own line with blank lines around it so GitHub renders the preview.

## Suggested flow (time-box ~30 minutes total)

1. Read the issue and the current proposal below. Read the code paths involved.
2. **Reproduce (time-box ~10-12 min):** if the bug is web-reproducible, try
   Playwright — e.g. start the dev server (`npm run web`, port 8082; it is slow
   to boot, don't wait more than a few minutes) and drive it with a throwaway
   script via `npx playwright`. If reproduction is impractical (native-only,
   needs an account/backend state you don't have, server too slow), SAY SO and
   verify the root cause by tracing the code instead — do not burn the whole
   budget on the environment.
3. **Fix:** implement the minimal correct fix in the working tree. Check the
   surrounding code and git history (`git log -p`, `git blame`) so the fix
   doesn't regress the case the current code was written for.
4. **Sanity-check** what you changed (lint/typecheck the touched files if fast:
   `npx tsc --noEmit` is too slow for the whole repo — prefer targeted checks;
   skip heavyweight verification rather than stalling).
5. **Rewrite the proposal** only if your findings changed it: same template
   (`## Proposal` / root cause / changes / optional alternatives), first person,
   evidence-backed, permalinks as bare URLs, small illustrative diff of the fix
   (never the full patch). If your investigation confirmed the proposal as-is,
   output UNCHANGED.

## Output contract (mandatory)

End your final message with exactly these two sections:

=== SUMMARY ===
2-5 sentences, plain text: whether you reproduced it (and how), the confirmed
root cause, what you changed (files), and any caveats.

=== PROPOSAL ===
The full updated proposal markdown, or the single word UNCHANGED.

## Issue

<<<ISSUE>>>

## Current proposal

<<<PROPOSAL>>>
