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
     2. **Auth via the shared persistent profile — HEADED REAL CHROME.**
        Expensify's API sits behind Cloudflare Bot Management, which serves a
        Managed Challenge (`cf-mitigated: challenge`, HTTP 403 on EVERY
        `/api/*` call) to automated fingerprints. Headless Chromium fails the
        challenge; a real headed Chrome solves it transparently, gets a
        `cf_clearance` cookie, and the dev proxy forwards that cookie so the
        API passes. So ALWAYS drive
        `chromium.launchPersistentContext('~/.tasker/pw-profile', { channel:
        'chrome', headless: false, viewport: null })` — real Chrome, NOT
        bundled Chromium, NOT headless. The clearance persists in the profile,
        so most runs skip the challenge entirely. If a run still lands on the
        Cloudflare interstitial, load `https://new.expensify.com` (or the dev
        origin) top-level once, let the JS challenge auto-resolve (a few
        seconds), then proceed — do NOT attempt to solve an interactive
        CAPTCHA (if one appears, fall back to Simulate and say so).
        Expensify sessions are long-lived, so most runs start
        already signed in — load the app and check. ONLY if signed out,
        **sign up fresh** (never sign in to an existing account — magic codes
        are dynamic and unreadable headlessly): use the brand-new address
        from the instructions below; the login screen shows a **Join**
        button for a never-used email, which creates the account instantly
        with no code. NEVER create a fresh account when the profile is
        already signed in: every signed-out app load fires unauthenticated
        API calls, and bursts of those + repeated sign-ups from one IP get
        Expensify's API 403-throttled, which breaks the API for later runs.
        Use a mobile viewport / device emulation when only mWeb variants are
        checked.
     3. **API reachability truths:** the app's API is same-origin `/api/*`,
        forwarded by the dev proxy (`web/proxy.ts`) to Expensify's PRODUCTION
        API at `www.expensify.com`; the same proxy also forwards a staging
        route to `staging.expensify.com`. The config-default host
        `www.expensify.com.dev` only exists inside Expensify's internal dev
        VM — its NXDOMAIN is EXPECTED here and never, by itself, a reason to
        abandon web. "You appear to be offline" while `:8082` serves 200
        means the API layer is failing — the banner cannot be dismissed
        client-side, so diagnose the cause:
        - **Network errors / timeouts** on `/api/*` → transient outbound
          blip: wait ~60s and retry once.
        - **HTTP 403 with `cf-mitigated`/`server: cloudflare` / a big HTML
          challenge body** on `/api/*` → a Cloudflare Managed Challenge, NOT
          an IP ban and NOT a rate limit. It is caused by an automated
          browser fingerprint. Fix it, don't wait it out: ensure you launched
          **headed real Chrome** (step 2), then load a top-level Expensify
          origin (`https://new.expensify.com`) so Chrome solves the JS
          challenge and stores `cf_clearance`; reload the app and re-check
          `/api/*`. The proxy forwards the browser's cookies, so once the
          browser holds `cf_clearance` the API passes. If it STILL 403s,
          switch to the staging API: the Settings → Troubleshoot toggle does
          NOT exist on local dev web (upstream disables it via
          `CONFIG.IS_USING_LOCAL_WEB` in `src/libs/ApiUtils.ts`), but this
          checkout carries a standing one-line local patch (hidden via git
          skip-worktree) removing that guard — NEVER revert, stash, or "clean
          up" `src/libs/ApiUtils.ts` unless your fix targets it. Seed
          `shouldUseStagingServer: true` into Onyx (IndexedDB `OnyxDB` →
          `keyvaluepairs`), reload, confirm traffic moves to `/staging/api/*`
          (solve the challenge on `https://staging.new.expensify.com` the
          same way if needed). Only after headed-Chrome + clearance + staging
          all fail do you fall back to Simulate, stating the 403 chain in the
          summary.
     4. **Seed the state the issue requires via the UI** — e.g. create the
        workspace / expense / split / message the repro steps mention. Most
        "cannot reproduce" outcomes are really "didn't set up the data"; the
        setup is part of the reproduction.
     5. Reproduce the reported steps and capture screenshots.
     6. **Verify the fix in the browser — Playwright is the DEFAULT.** You
        already reproduced the bug with your headed-Chrome Playwright script
        (steps 2–5) = the RED baseline. After implementing the fix, re-run
        that same script against the running dev server (same profile, same
        steps) and confirm the bug is GONE = GREEN. Capture before/after
        screenshots and state both plainly in the summary, e.g. "browser
        repro: error toast appeared before the fix, gone after (Playwright,
        headed Chrome)." This Playwright red→green IS the browser
        verification; do not require anything else for it.
        **fast-replay is a FALLBACK, not the default** — reach for it only
        when a durable, re-runnable artifact is worth leaving behind (a
        subtle/flaky repro you want the harness or the user to re-confirm
        later), or when your ad-hoc Playwright verification was
        inconclusive. When you do use it: author agent steps in
        `.repros/issue-<<<ISSUE_NUMBER>>>/recording.json` (selector
        `candidates` high-confidence first, a `semantic` string, `waitAfter`
        with a `timeoutMs`, `author: "agent"`; schema at
        `$(npm root -g)/fast-replay`), then `repro run
        issue-<<<ISSUE_NUMBER>>> --profile ~/.tasker/pw-profile --headed`
        (PASS = bug reproduces) and `--expect-fixed` after the fix (PASS =
        fixed); quote both verdict lines and leave
        `.repros/issue-<<<ISSUE_NUMBER>>>/` in the tree (it is stashed with
        the analysis). Close any browser on that profile first (one Chrome
        per profile dir). If the browser lane is unavailable (Cloudflare
        challenge unsolved / offline), the Jest red/green remains the
        verification floor for both paths.
     7. **Crash-safe interaction rule:** when the NEXT interaction is the one
        expected to trigger the bug (crash, freeze, render loop), never fire
        it as a bare Playwright click (`browser_click` / `locator.click()`) —
        if the page crashes, the click's actionability wait blocks forever and
        freezes this entire run. Dispatch it from JS with a hard timeout
        instead: `browser_evaluate` with
        `() => document.querySelector('<sel>').click()`, or in a script
        `Promise.race([page.evaluate(…), timeout(10s)])`. If the call then
        errors ("Execution context was destroyed", "Target crashed") — that IS
        the reproduction evidence: record it, screenshot if the tab still
        responds, and move on. Never retry the same interaction as a plain
        click.
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
If the "Current proposal" section below says none exists yet, you MUST output a
complete NEW proposal (never UNCHANGED) — it will be posted for you (immediately
if the issue already has Help Wanted, otherwise armed to auto-post the moment
Help Wanted lands). Follow the expensify-proposal-writer template exactly:
`## Proposal` / root cause / changes / optional alternatives, first person,
bare-URL SHA-pinned permalinks on their own lines, small illustrative diff.

## Issue

<<<ISSUE>>>

## Current proposal

<<<PROPOSAL>>>
