You are working in the local Expensify/App checkout (the current directory) on
issue #<<<ISSUE_NUMBER>>>. A proposal may already be posted; your job is to go
deeper than the proposal did: verify the root cause hands-on, reproduce the bug
if feasible, implement the real fix locally, and improve the proposal with what
you learned.

## Hard rules

- **Never commit, push, branch, or touch git history.** Leave your changes as
  uncommitted working-tree edits — the harness stashes them afterwards.
- Do not create PRs, issues, or new GitHub comments.
- **NEVER run lint, type-check, build, or formatting.** No `npm run lint`,
  `eslint`, `prettier`, `tsc`, `npm run typecheck`, `npm run build`, or any
  whole-project static check — they are slow, unnecessary here (your fix is
  stashed, never committed), and will blow the time budget. Your only sanctioned
  command runs are: the reproduction itself, and the **single targeted repro
  Jest test** for the red/green check (`npx jest <that one test file>`) — never
  the full suite. Verify code by reading it, not by compiling it.
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
3. **Reproduction gate — hard stop.** Reproducing live (or, on the Simulate
   fallback, empirically confirming the root cause in the Jest harness) is a
   precondition for everything after it. If you exhausted the flow above and
   neither happened, STOP: implement no fix, rewrite no proposal, revert any
   exploratory edits, and output NOT_REPRODUCED per the contract below with a
   summary of what you tried and what you observed instead. A fix for a bug
   you never saw is a guess — the entire value of this run is that everything
   in the proposal was watched happening.
4. **Fix:** implement the minimal correct fix in the working tree. Check the
   surrounding code and git history (`git log -p`, `git blame`) so the fix
   doesn't regress the case the current code was written for.
   **Write it the way this codebase already writes it.** Before coding, find
   how App solves the same shape of problem elsewhere (grep for a sibling
   component or flow that got this right) and mirror it: reuse the existing
   hook / util / action instead of inventing a parallel one, keep naming,
   error handling, and Onyx access idioms local to the file you're in. A fix
   that reads like it grew there is what the C+ merges; a correct fix in a
   foreign style invites a rewrite request or loses to a proposal that
   followed the conventions. If the codebase pattern IS the bug, say so in
   the proposal instead of silently diverging from it.
   **Always add or extend a deterministic Jest test that reproduces the bug**
   (fails on the unfixed code, passes with your fix) unless truly impossible —
   the harness automatically runs your changed test files with and without your
   source changes to verify the fix red/green, so the test is what turns your
   analysis into proof. Keep it fast and focused.
5. **Sanity-check** what you changed (lint/typecheck the touched files if fast:
   `npx tsc --noEmit` is too slow for the whole repo — prefer targeted checks;
   skip heavyweight verification rather than stalling).
6. **Rewrite the proposal** only if your findings changed it: same template
   (`## Proposal` / root cause / changes / optional alternatives), first person,
   evidence-backed, permalinks as bare URLs, small illustrative diff of the fix
   (never the full patch). Work the verification facts into both sections —
   the root cause carries what you observed at the faulty line while the bug
   was live, the changes carry what the fix verifiably changed (see the output
   contract). A run that reproduced and verified but
   left the proposal reading like static analysis has wasted its edge, so
   UNCHANGED is only right when the existing text already carries those facts.

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

## Output contract (mandatory)

End your final message with exactly these two sections:

=== SUMMARY ===
2-5 sentences, plain text: whether you reproduced it (and how), the confirmed
root cause, what you changed (files), and any caveats.

=== PROPOSAL ===
The full updated proposal markdown, or the single word UNCHANGED, or the single
word NOT_REPRODUCED (the reproduction gate tripped: no fix was implemented and
the existing proposal must stay untouched).

**Verification facts in, reproduction method out.** The method is yours, not
the reader's: leave out repro steps, environment/account setup, seeding or test
data, Playwright/fast-replay scripts, screenshots of the bug, and any narration
of what you tried. The C+ already has the repro steps — they are in the issue.
But the FACTS your live run produced are the proposal's strongest evidence and
belong in BOTH main sections. In the root cause: the runtime value or state you
observed at the faulty line while the bug was live, and the failure mode as it
actually presented — that turns the root cause from an argument into an
observation. In the changes: the verified outcome ("with this change the
duplicate highlight no longer appears; a regression test that fails on current
main passes with the fix"). One or two factual sentences per section, stated as
verified observations — this is what a proposal built on a live reproduction
has over one built on reading the code, so don't flatten it into speculation
("should fix") when you watched it work.

**Present the live evidence as evidence, not prose.** Rival proposals are
paragraphs and permalinks; yours should show the mechanism the way you actually
saw it. Default shape: a plain markdown bullet chain — NO code fence. One
bullet per causal step, the observed value inside the same clause, inline
code for real identifiers. It renders in normal proportional font, wraps on
any screen, and asks the reader to learn nothing:

- Reopened the DM after Reset and refresh. The network log shows one
  `OpenReport` for the whole flow, nothing after it.
- That response restores the SPLIT action but carries no transaction, so
  `transactions_<id>` never lands in Onyx.
- The preview renders from the missing transaction and never asks again.
  The skeleton was still there 12 seconds later.

3-6 bullets, every clause an observation, no filler steps, varied bullet
length (see "How it reads" below), and never
space-aligned columns inside a code fence — they collapse the moment GitHub
wraps a long line.

**A mermaid diagram matched to the bug's shape.** GitHub renders ```mermaid
fences natively in comments, and almost nobody uses them — a diagram of the
actual mechanism is the least imitable thing in a proposal. Pick the diagram
TYPE from what the bug actually is, not from rotation. Three types earn their
place:

**`flowchart` — a causal chain.** One thing causes the next causes the next.
This is the default and fits most bugs. Boxes are the flow, arrows are the
observed facts:

```mermaid
flowchart TD
    A["Save 0.00 on itemized page"] -->|"jsonCode 200"| B["maxExpenseAmountNoItemizedReceipt = 0"]
    B -->|"Rules row reads $0.00"| C["Enter 50 on receipt page"]
    C -->|"validate() returns {}, limit was 0"| D["Set receipt limit to 5000"]
    D -->|"jsonCode 666"| E["Auth UpdatePolicyAttributes returned an error"]
    E -->|"failureData restores previous value"| F["Silent rollback, nothing on screen changed"]
```

Flowchart-only rules, all learned from what actually renders on GitHub:
- **6 boxes or fewer → `flowchart TD`** (vertical). A comment column is tall,
  not wide, so vertical never runs out of room. This is the default.
- **More than 6 → `flowchart LR`** (horizontal). Prefer collapsing the trace
  to 6 first; past that, boxes stack too tall vertically.
- **Never wrap a long chain with subgraphs.** Mermaid anchors cross-subgraph
  edges at the subgraph boundary rather than the real node, so the connector
  leaves from the middle of one row and lands in the middle of the next,
  implying causality that does not exist.
- Quote every label (`A["..."]`, `-->|"..."|`). Parentheses, braces and
  colons break the parse unquoted, and real evidence is full of them.

**`sequenceDiagram` — a race or an ordering.** Two requests, two effects, or
client vs server, where the bug is WHICH ARRIVED FIRST rather than what caused
what. A flowchart cannot show concurrency; this can. 2-4 participants, no
more:

```mermaid
sequenceDiagram
    autonumber
    participant P as Page
    participant S as Server
    participant O as Onyx
    par cold boot
        P->>S: OpenReport (mount effect, sent once)
    and
        P->>S: OpenApp
    end
    S-->>O: OpenReport onyxData, 3 transactions
    S-->>O: OpenApp setcollection replaces transactions_
    Note over O: report present, total -423937, txnCount 0
```

- Message text after `:` is raw — do NOT quote it the way flowchart labels are
  quoted, and keep semicolons out of it.
- `Note over X: value` is where the measured state goes.
- `par ... and ... end` for the concurrent legs, `autonumber` when the order
  itself is the point.

**`stateDiagram-v2` — a component stuck in a state.** A lifecycle that enters
a state and has no edge out, or takes the wrong edge. Use it when the fix is
"add the missing transition", not when the bug is a chain:

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Loaded: transactions land
    Loading --> Loading: OpenApp replaces collection, txnCount 0
    note right of Loading: shouldWaitForTransactions stays true, no re-fetch
```

- State ids cannot contain spaces. Use `state "long name" as s1` for anything
  longer than a word.
- Transition labels go after a `:`, unquoted.

Other mermaid types render too (class, ER, gitGraph), but they describe
structure rather than mechanism and almost never fit a bug — reach for one
only if it genuinely is the bug. A bad-fit exotic diagram is worse than the
default flowchart, and a misleading diagram is worse than no diagram at all.
The type comes from the mechanism, never from wanting to look different.

When the bug is missing-or-wrong state rather than a chain, a ```diff snapshot
is the sharper shape (`+` the state that exists, `-` the state that never
arrived — GitHub colors them green/red, so the mismatch is visible before a
word is read). 2-4 real console/log lines still fit timing bugs. Pick
whichever fits the bug and vary the shape between proposals — one repeated
template across our proposals is its own tell. Every value shown must be one
you actually observed in the run; a reconstructed-from-imagination trace is
worse than plain prose. Put the reproduction story itself in
`=== SUMMARY ===` above, which is for the user alone and is never posted to
GitHub.
If the "Current proposal" section below says none exists yet, you MUST output a
complete NEW proposal (never UNCHANGED; NOT_REPRODUCED still applies when the
gate tripped) — it will be posted for you (immediately
if the issue already has Help Wanted, otherwise armed to auto-post the moment
Help Wanted lands). Follow the expensify-proposal-writer template exactly:
`## Proposal` / root cause / changes / optional alternatives, first person,
bare-URL SHA-pinned permalinks on their own lines, small illustrative diff.

## Issue

<<<ISSUE>>>

## Current proposal

<<<PROPOSAL>>>

## MelvinBot's proposal (your competition)

The C+ chooses between this and ours, so yours has to be visibly better. Read it
first: if it names the same root cause, say what it missed or prove the mechanism
it only asserts — your verified red/green is the edge it cannot have. If it is
wrong, show why. Never restate it. If it is absent, ignore this section.

<<<MELVIN>>>
