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
2. **Reproduce (time-box ~10-12 min for web, more for native) — the platform is
   NOT your choice: read the issue's "Platforms:" checklist and follow this RULE:**
   - **Any web platform checked** (Windows: Chrome, MacOS: Chrome Safari, or any
     mWeb variant) → **web verification in the browser is enough.** Do this
     properly, in this order:
     1. **The app URL is ALWAYS `https://dev.new.expensify.com:8082` — never
        any other port.** First check whether a dev server is already serving:
        `curl -sk https://dev.new.expensify.com:8082/` — if it responds, REUSE
        it (do NOT start a second server; rsbuild would auto-increment to 8083,
        which is a broken origin for this app). Only if 8082 is not serving:
        start `npm run web` in the background first thing and go read the code
        while it boots — it can take up to ~10 minutes; poll the URL until it
        serves, and only abandon web if it still isn't serving after ~12
        minutes. If the server you started comes up on any port other than
        8082, kill it and re-check 8082. When you're done, kill only the
        server processes YOU started this run — never a pre-existing one.
     2. **Sign up fresh** (never sign in to an existing account — magic codes
        are dynamic and unreadable headlessly): use the brand-new address from
        the instructions below; the login screen shows a **Join** button for a
        never-used email, which creates the account instantly with no code.
        Drive it with a `npx playwright` script; use a mobile viewport / device
        emulation when only mWeb variants are checked.
     3. **Seed the state the issue requires via the UI** — e.g. create the
        workspace / expense / split / message the repro steps mention. Most
        "cannot reproduce" outcomes are really "didn't set up the data"; the
        setup is part of the reproduction.
     4. Reproduce the reported steps and capture screenshots.
     Do not spin up native builds when web is checked. If no test account is
     configured and the flow requires auth, say exactly that as the fallback
     reason.

     Test account for staging/dev sign-in: <<<TEST_ACCOUNT>>>
   - **ONLY "Android: App" checked** (no web) → you MUST attempt the Android
     emulator: boot the AVD headless (`emulator -avd Medium_Phone_API_36.0
     -no-window -no-audio &`, `adb wait-for-device`), then build+install with
     **`npm run android`** (it pulls a prebuilt APK from rock's remote cache —
     fast). If the build fails: `git clean -fdx android/` and re-run — that
     recovery is known-good. Drive the UI with `adb shell input tap/swipe/text`
     + `adb exec-out screencap -p > shot.png` (read the screenshots). Kill the
     emulator when done.
   - **ONLY "iOS: App" checked** (no web) → you MUST attempt the iOS simulator:
     **`npm run ios`** (run `npm run pod-install` first if `ios/Pods` is
     missing); drive via `xcrun simctl` (boot/install/launch/screenshot).
   - **Both native apps checked, no web** → Android first (warmer, easier to
     drive); iOS only if the behavior can't be shown on Android.
   - **Simulate** — the fallback, never the first choice when the required
     platform is runnable: use it when the required platform genuinely cannot
     run (build breakage beyond the known recovery, won't fit the time budget)
     or the repro needs account/backend state you don't have. Reconstruct the
     reported conditions deterministically in a Jest harness — mock the Onyx
     state / navigation / API responses — and empirically CONFIRM or DISPROVE
     the proposal's root cause against production code paths. If you fall back,
     STATE explicitly why the required platform couldn't be attempted.
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
