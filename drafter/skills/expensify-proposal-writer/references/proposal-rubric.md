# Expensify Proposal Rubric

## Problem Statement

Use this format when writing or validating a problem:

```text
Problem: When X happens, it causes Y, which prevents us from Z.
```

State direct cause and effect with minimal analysis. The problem statement must not mention the desired solution.

Reject or rewrite problem statements that say:

- `We do not have X`, followed by `Build X`.
- `We lack insight/visibility/awareness`, without saying what action is blocked.
- `A, B, C, D, and E are problems`, followed by one solution.
- `X is inefficient/error-prone`, without measurable evidence or a tangible consequence.

A good problem statement allows multiple possible solutions. If only one solution fits, it is probably a reverse solution statement.

## Expensify Proposal Priorities

Expensify prioritizes high-value, measurable problems over small optimizations whose impact is hard to prove. Each proposed job should:

- Fix one specific problem.
- Explain why the problem matters to users or the business.
- Provide evidence from the issue, reproduction, code path, logs, screenshots, or linked comments.
- Solve the root cause where practical rather than adding a workaround.
- Define a result that can be evaluated after implementation.

Speed matters because multiple contributors may write proposals for the same issue. Optimize for the fastest credible proposal:

- Use targeted investigation rather than exhaustive exploration.
- Include RCA permalinks when they are available quickly.
- If a permalink would take too long to produce, provide the best local file/function reference and say what should be confirmed.
- Do not sacrifice correctness for speed, but do not delay a clear proposal to polish wording or collect marginal evidence.

If the request is a new idea rather than an issue proposal, use:

```markdown
**Strategy:** [What broader objective this supports.]
**Problem:** [When X happens, it causes Y, which prevents us from Z.]
**Solution:** [Specific proposed change.]
```

## RCA Evidence

Use permalinks when referencing implementation details. Prefer stable GitHub links to exact files and line numbers when available.

Good RCA evidence includes:

- A reproduction path that explains where state or UI diverges from expected behavior.
- The specific component, action, utility, API response, or Onyx key involved.
- A short explanation of why that code path causes the reported behavior.
- A code permalink for the relevant root cause.

Avoid weak RCA language:

- `Maybe this is caused by...`
- `I think this might be...`
- `We can fix it by...` before explaining the cause.

If evidence is incomplete, state the assumption clearly and say what would confirm it.

## Solution Guidance

The solution should be small enough to review but complete enough to fix the root cause.

Use plain English first. Add tiny code snippets only when they clarify the exact change. Avoid large multi-line diffs because the proposal template explicitly says not to post code diffs.

Good solution content:

- Names the exact function, component, route, action, or data structure to change.
- Explains how the change addresses the RCA.
- Mentions affected platforms when relevant.
- Includes migration, offline, optimistic update, or accessibility concerns when the issue touches those areas.
- Identifies tests or QA steps that prove the result.

Bad solution content:

- A broad refactor without showing why it is needed.
- A workaround that leaves the root cause intact.
- A code dump that reads like a PR.
- Multiple unrelated fixes bundled into one proposal.

## Alternatives

Include alternatives only when useful. For each one, state why it is less suitable:

- It solves only a symptom.
- It has broader blast radius.
- It adds complexity without measurable benefit.
- It depends on unavailable data or a larger product decision.

## Final Review Checklist

Before returning a proposal, verify:

- It follows `contributingGuides/PROPOSAL_TEMPLATE.md`.
- The problem statement is not a solution in disguise.
- The root cause is specific and evidence-backed.
- The solution fixes the root cause.
- The proposal is brief and plain-English.
- Code snippets, if any, are short and explanatory.
- RCA permalinks are included when available.
