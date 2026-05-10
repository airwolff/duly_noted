---
audit: 2026-05-10-slice-4-summarization.md
date: 2026-05-10
triage_outcome: 1 fix-now, 0 defer, 2 wont-fix
---

# Fix brief — Slice 4 summarization audit

## Code fixes

### F1 — Enrich length-bound failure messages with actual length

**SPEC reference.** §Stage 6 line 306: "Length-bound violation: same handling — fails the row with `last_error` recording the actual length and the configured bounds."

**Gap.** Both Slice 3 (`step3OutputSchema`, title/description bounds) and Slice 4 (`summaryOutputSchema`, summary bound) parse Zod errors and pass `err.message` directly to `markFailed`. Zod's default messages include the configured bound but not the offending input length. Slice 4 introduces the SPEC requirement; Slice 3 inherits the same gap and is fixed in parallel for convention consistency.

**Files.**

1. `apps/worker/src/pipeline/summarize.ts` (around line 135–149)

   Wrap `summaryOutputSchema.parse(raw)` failures so the `last_error` written by `markFailed` includes the actual length of the LLM-returned `summary` string alongside the configured `[SUMMARY_MIN_CHARS, SUMMARY_MAX_CHARS]` bounds. Non-length Zod issues (shape, type) pass through unchanged with the existing message.

   Suggested shape (adjust to file's existing import style and helpers):

```ts
   import { ZodError } from 'zod';
   import { SUMMARY_MIN_CHARS, SUMMARY_MAX_CHARS } from '@duly-noted/shared/summarization/constants';

   try {
     const parsed = summaryOutputSchema.parse(raw);
     // ...
   } catch (err) {
     if (err instanceof ZodError) {
       const issue = err.issues[0];
       if (issue && (issue.code === 'too_big' || issue.code === 'too_small')) {
         const actualLen =
           typeof raw === 'object' && raw !== null && 'summary' in raw && typeof (raw as { summary: unknown }).summary === 'string'
             ? (raw as { summary: string }).summary.length
             : 'unknown';
         const message = `summary length ${actualLen} out of bounds [${SUMMARY_MIN_CHARS}, ${SUMMARY_MAX_CHARS}]`;
         await markFailed(deps.supabase, meeting.id, message);
         return;
       }
     }
     const message = err instanceof Error ? err.message : String(err);
     await markFailed(deps.supabase, meeting.id, message);
   }
```

2. `apps/worker/src/pipeline/segment.ts` (around line 244, the `step3OutputSchema.parse` failure path)

   Apply the same enrichment for `TITLE_MAX_LEN` / `DESCRIPTION_MAX_LEN` violations. The Zod issue's `path` identifies which field failed (`title` or `description`); use that to select the right bound constant and pull the actual length from the corresponding field on the parsed candidate.

**Tests.**

- Add a test in `summarize.test.ts` that simulates the LLM returning a 47-char summary (below `SUMMARY_MIN_CHARS`) and asserts `markFailed` is called with a message containing the actual length and both bounds.
- Add a parallel test in `segment.test.ts` for an oversize chapter title.
- Existing schema-shape tests continue to assert non-length Zod errors flow through with the original message.

**Verification.**

- `pnpm -r typecheck` clean
- `pnpm -r test` passes
- Spot a `last_error` row from a forced-failure scenario in cloud Supabase to confirm the message format renders cleanly in the dashboard.

## SPEC.md updates

None.

## CLAUDE.md updates

None.

## ADR updates

None.

## Wont-fix items

The following audit items were accepted as wont-fix during triage. Reasoning and revisit triggers were promoted to `_known-non-issues.md` via the promote-to-non-issue skill — see registry IDs below.

- **Q1** — Failure-path UPDATE in worker handlers is unconditional, not status-guarded. → NI-016
- **Q2** — Claim RPCs return more columns than the handler currently consumes. → NI-017
