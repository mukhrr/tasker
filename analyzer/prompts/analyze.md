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
2. **Reproduce (time-box ~10-12 min) — work down this ladder, top rung that fits:**
   - **Web** (fastest, prefer when the bug is web-reproducible): start the dev
     server (`npm run web`, port 8082; slow to boot — don't wait more than a few
     minutes) and drive it with a throwaway `npx playwright` script.
   - **Android emulator** (when the bug is native-only): boot the AVD headless
     (`emulator -avd Medium_Phone_API_36.0 -no-window -no-audio &`,
     `adb wait-for-device`), then build+install with **`npm run android`**.
     If the Android build fails: run `git clean -fdx android/` and re-run
     `npm run android` — that recovery is known-good for this checkout.
     Drive the UI with `adb shell input tap/swipe/text` +
     `adb exec-out screencap -p > shot.png` (read the screenshots to see the
     screen). Kill the emulator when done. If the build clearly won't fit the
     remaining time budget, drop to the Simulate rung instead of stalling.
   - **iOS simulator**: use **`npm run ios`** (run `npm run pod-install` first
     if `ios/Pods` is missing); drive via `xcrun simctl`
     (boot/install/launch/screenshot). Same rule: if the build won't fit the
     budget, simulate instead.
   - **Simulate** (first-class outcome, not a failure — use it whenever live
     repro is blocked by account/backend state, missing warm builds, or
     platform limits): reconstruct the reported conditions deterministically in
     a Jest harness — mock the Onyx state / navigation / API responses the
     issue describes — and empirically CONFIRM or DISPROVE the proposal's root
     cause against production code paths. Disproving a wrong root cause this
     way is as valuable as a repro; say clearly which you did.
3. **Fix:** implement the minimal correct fix in the working tree. Check the
   surrounding code and git history (`git log -p`, `git blame`) so the fix
   doesn't regress the case the current code was written for.
   **Always add or extend a deterministic Jest test that reproduces the bug**
   (fails on the unfixed code, passes with your fix) unless truly impossible —
   the harness automatically runs your changed test files with and without your
   source changes to verify the fix red/green, so the test is what turns your
   analysis into proof. Keep it fast and focused.
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
