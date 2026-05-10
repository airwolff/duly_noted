---
date: 2026-05-10
scope: Slice 4 summarization build — schema deltas + worker handler + shared schemas/prompts
commit_range: e021d1e..70c81ff
head_sha: 70c81ff
prior_audit: 2026-05-10-slice-3-fix-reaudit.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 1
questions_count: 2
findings_dropped_by_verification: 1
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 4 summarization

Two commits in scope:

- `e7d84d1` — `chore(db): slice 4 summarization schema` — adds `summarizing_inflight` transient enum value, `meetings.summary` and `meetings.summary_generated_at` columns, and the `claim_summarizing_meeting()` / `complete_summarization(uuid, text)` RPCs.
- `70c81ff` — `feat(worker): slice 4 summarization handler` — new `apps/worker/src/pipeline/summarize.ts` handler, `packages/shared/src/summarization/` (constants, schemas, prompts, barrel + tests), `packages/db/src/types.ts` updates, and poll-loop wiring (`run.ts`, `poll-loop.ts`).

## Mechanical pass results

| Check                                | Result                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm -r typecheck`                  | clean (5 workspaces)                                                            |
| `pnpm -r lint`                       | clean (5 workspaces)                                                            |
| `pnpm -r test`                       | 91 tests passing (50 shared / 2 db / 23 worker-cron / 16 worker / 0 web)        |
| `pnpm format:check`                  | clean                                                                           |
| `git diff --shortstat e021d1e..HEAD` | 13 files changed, 865 insertions(+), 6 deletions(-)                             |
| TODO/FIXME/XXX in changed files      | none                                                                            |
| `console.*` outside `apps/worker*`   | none                                                                            |
| Hardcoded URLs in changed src        | none                                                                            |
| Secret-shaped strings                | none (false positive on `SUMMARY_MAX_OUTPUT_TOKENS` constant — not a secret)    |
| `.env*` literal references           | none                                                                            |
| New files > 500 LOC                  | 0 (largest: `summarize.test.ts` at 275 LOC)                                     |
| Existing files growing > 200 LOC     | 0                                                                               |
| Source vs test files added           | 4 source / 3 test new — handler + shared schemas/prompts/constants paired with tests |

The mechanical surface is clean. The build mirrors the Slice 3 architecture: claim RPC sets a transient state (`summarizing_inflight`) atomically inside the SQL function, the worker runs the LLM call outside any open Postgres transaction, and a complete RPC writes the result with a `WHERE status = 'summarizing_inflight'` guard for write-side idempotency. The handler runs first in the poll-loop dispatch chain (summarize → segment → pending), preserving the closer-to-publication-first convention.

## Findings

### F1 — Length-bound `last_error` does not record the actual returned length

- **Severity:** LOW
- **Source:** P1 (verified: true, confidence 95, kept as Finding)
- **File:line:** `apps/worker/src/pipeline/summarize.ts:147-149` (catch block) → `apps/worker/src/pipeline/fail.ts:14-19` (truncation), via `summaryOutputSchema.parse(raw)` at `apps/worker/src/pipeline/summarize.ts:135`
- **Finding:** When the LLM-returned summary fails Zod's `.min()` / `.max()` check, the message captured in `last_error` is Zod's default — `"String must contain at most 2000 character(s)"` (or `at least 200`) — which records the **configured bound** but not the **actual length** of the offending output. SPEC §Stage 6 Failure modes line 306 explicitly requires both: "Length-bound violation: same handling — fails the row with `last_error` recording the actual length and the configured bounds."
- **Evidence:**
  - SPEC.md:306 (verbatim): "Length-bound violation: same handling — fails the row with `last_error` recording the actual length and the configured bounds."
  - `summarize.ts:135`: `const parsed = summaryOutputSchema.parse(raw);`
  - `summarize.ts:147-149` (catch): `const message = err instanceof Error ? err.message : String(err);` → `markFailed(deps.supabase, meeting.id, message)`. The `message` here is whatever Zod's `ZodError.message` produced; nothing in the catch path enriches it with the actual length of `raw.summary`.
  - Zod 3.x default `too_big` / `too_small` issue messages: `"String must contain at most/least N character(s)"` — `N` is the bound; no actual-length term in the default string. The `ZodIssue` object exposes `maximum` / `minimum` and `type` but not the failing input's length, and the default `.message` does not interpolate it.
- **Verification reasoning:** SPEC phrase exists at line 306 and is specifically about length bounds (not generic shape validation). Zod's default message structure is well-known. The catch block passes `err.message` straight through with no length enrichment. The same gap exists in Slice 3's `step3OutputSchema` (`TITLE_MAX_LEN`, `DESCRIPTION_MAX_LEN`) — this is a Slice-3-precedent gap that Slice 4 inherits, not a regression introduced here. Recording it as a Slice-4 finding because the SPEC requirement is in §Stage 6 (Slice 4's section), explicit, and load-bearing for ops debugging when a summary call lands in `failed`.
- **Confidence:** 95.

## Questions for human

### Q1 — `markFailed()` is unconditional; failure path relies on control-flow guarantee rather than RPC-enforced status guard

- **File:line:** `apps/worker/src/pipeline/fail.ts:20-27` (used from `apps/worker/src/pipeline/summarize.ts:148`)
- **Question:** SPEC §Stage 6 (the new line added in commit `402f42b` planning Slice 4) describes the failure path as "a separate UPDATE (or an `abandon_summarizing_meeting` RPC if Slice 3 has the parallel) sets `summarizing_inflight → failed` with `last_error` and `failed_at` populated." The implementation uses `markFailed()`, which is the existing helper from Slice 2/3 — `update meetings set status='failed', last_error=…, failed_at=now() where id = $meetingId` with **no status guard**. The complete-path RPC `complete_summarization` does have a `WHERE status = 'summarizing_inflight'` guard with idempotency; the failure path does not. Slice 3 has the exact same shape (`segment.ts:315` calls the same unconditional `markFailed`). Is the unconditional-update-with-control-flow-guarantee design the intended convention, or does the SPEC's "separate UPDATE … sets `summarizing_inflight → failed`" wording want a status-guarded failure UPDATE (or an `abandon_summarizing_inflight` / `abandon_chaptering` RPC) added as a follow-up?
- **Why this needs human input:** The current handler control flow makes `markFailed` provably callable at most once per claimed row in `summarizing_inflight` state, so the unconditional update is operationally safe today. Adding a status-guarded RPC (or guarding `markFailed` itself) would be defensive against (a) future code paths that call `markFailed` from other contexts, (b) parallel workers if v2 deploys multiple worker instances, (c) the kind of "claim succeeded, complete also succeeded, then a delayed network error makes the worker think it failed" race that the complete-path WHERE clause already protects against. Whether that defense is worth the surface area is a v1-vs-v2 call. Same question applies retroactively to Slice 3's `markFailed` use — answering this for Slice 4 lets the answer carry over.
- **Evidence:**
  - `fail.ts:20-27`: `update({ status: 'failed', last_error: truncated, failed_at: ... }).eq('id', meetingId)` — no status filter.
  - `summarize.ts:147-150`: `await markFailed(deps.supabase, meeting.id, message);` inside `catch (err)`.
  - `segment.ts:315` (Slice 3): identical `await markFailed(deps.supabase, meeting.id, message);` after a claim that transitioned `segmenting → chaptering`.
  - `supabase/migrations/20260510141247_slice_4_summarization_schema.sql:108-118` — `complete_summarization` RPC uses `WHERE id = p_meeting_id AND status = 'summarizing_inflight'` with `if updated_count = 0 then raise exception`. The asymmetry between the complete path and the failure path is the substantive question.

### Q2 — `claim_summarizing_meeting()` returns `youtube_id` but the handler never reads it

- **File:line:** `supabase/migrations/20260510141247_slice_4_summarization_schema.sql:50-55` (RPC return list) and `apps/worker/src/pipeline/summarize.ts:42-49` (`ClaimedSummarizingMeeting` interface)
- **Question:** The new RPC returns five columns: `id`, `board_id`, `title`, `meeting_date`, `youtube_id`. The handler uses `id` (for the complete RPC and markFailed), `board_id` (to JOIN-load board+town names), `title`, and `meeting_date` (for the prompt). It never reads `youtube_id`. The RPC could return four columns, or the handler could log the `youtube_id` for ops correlation. Slice 3's `claim_segmenting_meeting` has the same shape: it returns `duration_seconds` which `runSegmentationOnce` never reads. Is the precedent intentional ("claim returns row identity in case any handler later needs it") or accidental ("nobody noticed during build")?
- **Why this needs human input:** Two reasonable resolutions exist. Either (a) keep both RPCs as-is — the over-provisioning is harmless, mirrors Slice 3, and the `youtube_id` may inform a future ops-correlation log line in `poll-loop.ts` similar to the existing `meeting=${id}` field; or (b) trim `claim_summarizing_meeting` to the four columns the handler actually consumes and add an audit follow-up to trim Slice 3's RPC the same way. The decision sets the convention going forward (B5 transcript-aware handler, future re-summarize RPC, etc.).
- **Evidence:**
  - Migration `claim_summarizing_meeting` returning `id, board_id, title, meeting_date, youtube_id`.
  - `summarize.ts` references after claim: `meeting.id`, `meeting.board_id`, `meeting.title`, `meeting.meeting_date`. No `meeting.youtube_id` reference.
  - `segment.ts` precedent (Slice 3): `claim_segmenting_meeting` returns `id, transcript_url, duration_seconds`; only `id` and `transcript_url` are consumed in `runSegmentationOnce`.

## Reopen candidates

None.

## What NOT to fix (this audit)

- **Auto-advance `summarizing → published` skipping `review`.** SPEC §Stage 6 line 300 explicitly closes this as the v1 stance: "no row should sit in `review` at v1." Backlog B4 reopens it when an operator UI lands.
- **Segments-only summarization (no `transcript.json` open).** SPEC §Stage 6 line 269 explicit: "the handler does not open `transcript.json`." Backlog B5.
- **Single LLM call (no per-chapter description deepening).** SPEC §Stage 6 line 267 explicit.
- **No `temperature` parameter on the Anthropic call.** SPEC §Stage 4 (referenced from §Stage 6) — adaptive thinking is always-on for Opus 4.7; passing `temperature` is a 400.
- **`minLength` / `maxLength` only in Zod, not in JSON schema.** SPEC §Stage 6 line 286 explicit; ADR 0018.
- **Both new columns (`summary`, `summary_generated_at`) nullable indefinitely.** SPEC §Slice 4 schema deltas line 470 explicit; NOT NULL deferred.
- **No new RLS policy or GRANT on `meetings`.** SPEC §Slice 4 schema deltas line 476: "the existing `authenticated` SELECT-where-status-published policy on `meetings` covers the new columns. Same pass-2 tenant-boundary deferral applies (NI-008)."
- **No FK index on `meetings.board_id` for the new JOIN.** Already deferred to pass-2 indexing slice; the v1 volume (~24 meetings/year) doesn't justify it.
- **Mirror of Slice 3 mock-Supabase test stub.** `summarize.test.ts:32-115` reuses the Slice 3 `makeStubClient` shape (per-table `from()` branches with chained `select/eq/order/single` returns). Some duplication exists between `segment.test.ts` and `summarize.test.ts`; sharing a test fixture across pipeline handlers is not pulled into v1 because the two stubs handle different table sets. Acceptable.

## Suggested fix order

1. **F1** — adjust the catch block in `summarize.ts` (and consider lifting the same enrichment into Slice 3's `segment.ts:244` for the `step3OutputSchema.parse` failure mode) to wrap the Zod error with a message that includes the actual length, e.g.:
   ```ts
   if (err instanceof ZodError) {
     const issue = err.issues[0];
     if (issue?.code === 'too_big' || issue?.code === 'too_small') {
       const actualLen = typeof raw === 'object' && raw !== null && 'summary' in raw && typeof raw.summary === 'string'
         ? raw.summary.length : 'unknown';
       throw new Error(`summary length ${actualLen} out of bounds [${SUMMARY_MIN_CHARS}, ${SUMMARY_MAX_CHARS}]`);
     }
   }
   ```
   Then triage Q1 and Q2.

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 1     |
| NIT      | 0     |

- Findings: 1 (F1, LOW, confidence 95)
- Questions for human: 2 (Q1 markFailed pattern, Q2 RPC over-provisioning)
- Findings dropped by verification: 1 (P4 candidate "`SummaryOutput` type exported but not consumed" — verified as identical-shape to NI-014's accepted speculative-export pattern, suppressed)
- Findings suppressed by `_known-non-issues.md`: 0

The Slice 4 build is materially aligned with SPEC §Stage 6 and the architectural precedent set in Slice 3. The single behavioral gap (F1) is a SPEC-mandated `last_error` content requirement that both Slice 3's segmentation step and Slice 4's summarization step satisfy only partially, and is an ops-debug nicety rather than a correctness bug. The two questions concern conventions that affect Slice 3 retroactively as well, and are best decided once for both slices.
