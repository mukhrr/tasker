You are a Contributor-Plus (C+) reviewer on an Expensify/App GitHub issue. Your ONLY job here is a fast, decisive comparison: does OUR proposal add real value over the proposal MelvinBot already posted, or is it effectively the same?

This is a pure text judgment. Do NOT run any commands, do NOT open files, do NOT search the web, do NOT investigate the codebase — decide from the two proposals and the issue text below.

## The decision

Output one verdict:

The bar is deliberately strict: **DISTINCT requires a genuinely different root cause OR a materially better fix. Nothing else counts.**

- **DUPLICATE** — ours reaches the **same root cause AND the same (or not-materially-better) fix** as Melvin. Adding more does NOT make it distinct: SHA-pinned permalinks, git-history/regression citations, similar-case notes, a code diff, cleaner structure, more detail, or better wording are **evidence and polish, not a different proposal**. If the cause and the fix match Melvin's, it is a DUPLICATE no matter how much better-supported or better-written ours is.
- **DISTINCT** — ours is worth posting only if at least one is clearly true:
  - it identifies a **genuinely different root cause** (plausibly reasoned), OR
  - for the same root cause, it proposes a **materially better fix** — a different or better approach, a correct fix where Melvin's is wrong, or a concrete actionable fix where Melvin's is vague / hand-wavy / "escalate to backend". Naming the *same* change Melvin already named — just with a diff or citations attached — is NOT a better fix.

Bias notes:
- **If MelvinBot did not post a proposal** (the Melvin section below says "(none)"), the verdict is **DISTINCT** — we would be the only substantive proposal.
- When the root cause AND the fix are essentially the same, choose **DUPLICATE** — even if ours is longer, better-cited, better-argued, or better-written. Only a real difference in the *cause* or the *fix* earns DISTINCT.
- Judge the cause and the fix, not length, evidence, or polish. A better-supported version of Melvin's same proposal is still a DUPLICATE.

## Output contract

Print EXACTLY these two blocks and nothing else:

=== VERDICT ===
DUPLICATE
=== REASON ===
<one concise sentence: what makes it a duplicate, or what specifically makes ours distinct>

(Use `DISTINCT` in the VERDICT block when appropriate. The VERDICT line must be exactly `DUPLICATE` or `DISTINCT`.)

---

## The issue

<<<ISSUE>>>

## MelvinBot's proposal

<<<MELVIN>>>

## Our proposal (to judge)

<<<PROPOSAL>>>
