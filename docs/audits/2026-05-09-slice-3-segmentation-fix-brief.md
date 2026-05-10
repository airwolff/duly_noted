---
date: 2026-05-09
scope: Triage outcomes (fix-now) from 2026-05-09-slice-3-segmentation.md audit
source_audit: docs/audits/2026-05-09-slice-3-segmentation.md
decisions_in_scope: F1, Q1, Q2, Q3, Q4, Q8, Q9, Q10
companion: 2026-05-09-slice-3-segmentation-wontfix-brief.md
---

# Fix brief — Slice 3 segmentation triage

Six items triaged fix-now. Two work streams: code fixes and a
docs-only SPEC update. Wont-fix items live in the companion
`2026-05-09-slice-3-segmentation-wontfix-brief.md`.

## Work stream A — code fixes (one CC session, fresh)

Per build-cycle.md step 7, do not reuse the audit session. Plan
mode optional given small scope.

### F1 — scope `withRetry` to retriable Anthropic SDK errors

**File:** `apps/worker/src/pipeline/anthropic.ts:34-49`

Discriminate on Anthropic SDK error subclasses. Retry only on:

- `APIConnectionError`
- `APIConnectionTimeoutError`
- `InternalServerError`
- `RateLimitError`

Let `AuthenticationError`, `BadRequestError`, JSON parse errors,
and all other thrown errors propagate immediately.

Configure the Anthropic client with `maxRetries: 0` so the SDK's
own retry behavior does not stack on top of `withRetry`. Without
this the worker can perform up to 12 request attempts on a true
5xx, exceeding the SPEC's 3× budget.

Suggested commit: `fix(worker): scope withRetry to retriable Anthropic errors`

### Q2 (code half) — log when sub-second coerce fires

**File:** `apps/worker/src/pipeline/segment.ts:243-246`

When the worker applies `endSec = startSec + 1` to satisfy the
`end_time_seconds > start_time_seconds` CHECK constraint, emit a
`logger.warn` with `meeting_id`, segment `sequence_order`, and the
original `startUtt.start` / `endUtt.end` millisecond values.

The coerce stays. Visibility is the only addition.

Suggested commit: `fix(worker): warn when sub-second segment coerce fires`

### Q8 — extract shared `parseTTokenIndex` helper

**Files:**
- `packages/shared/src/segmentation/t-tokens.ts` (add export, update `lookupTToken`)
- `apps/worker/src/pipeline/segment.ts:81-87` (consume)

Add to `t-tokens.ts`:

```typescript
export function parseTTokenIndex(token: string): number | null {
  const match = /^\[T(\d+)\]$/.exec(token);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}
```

Refactor `lookupTToken` to call `parseTTokenIndex`: if null or
index out of bounds, return null; otherwise return the matched
utterance start.

Refactor worker-side `tIndex` to call `parseTTokenIndex`: if null,
throw with the original error message; otherwise return the index.

The regex contract now lives in one file. Add a unit test for
`parseTTokenIndex`: valid token, invalid format, missing brackets,
non-numeric body.

Suggested commit: `refactor(shared): extract parseTTokenIndex shared helper`

### Q9 — widen `CallStructured.jsonSchema` param type

**Files:**
- `apps/worker/src/pipeline/anthropic.ts` (CallStructured signature)
- `apps/worker/src/pipeline/segment.ts:158, 194, 232` (drop casts)

Change the parameter type on `CallStructured.jsonSchema` from
`Record<string, unknown>` to `Readonly<Record<string, unknown>>`.

The three `as unknown as Record<string, unknown>` casts on
`step1JsonSchema`, `step2JsonSchema`, `step3JsonSchema` collapse
to direct passes.

Suggested commit: `refactor(worker): accept readonly JSON schemas in CallStructured`

### Q10 — replace defensive `continue` with `throw`

**Files:**
- `apps/worker/src/pipeline/segment.ts:185` (markers loop)
- `apps/worker/src/pipeline/segment.ts:224` (ends loop)

Replace both `if (!marker) continue` (and equivalent on `ends[i]`)
with `throw new Error('invariant violation: markers[i] undefined inside bounded loop')`
and matching wording for `ends`.

The throw is unreachable today. If the invariant ever drifts under
a future refactor, the meeting fails fast with a clear error rather
than silently dropping a segment.

Suggested commit: `fix(worker): throw on invariant violation in segment assembly`

## Work stream B — SPEC update (one docs-only PR)

Single commit. No code change. Closes Q1, Q2-spec, Q3, Q4.

### Q1 — add `chaptering` to enum, schema deltas, state diagram

Three SPEC sections need the transient enum value:

1. **§Stage 5 enum list (~lines 273-276):** add `chaptering` to the
   `meeting_status` enum values, positioned between `segmenting`
   and `summarizing`.
2. **§Stage 5 Slice 3 deltas (~lines 348-404):** document the
   enum addition explicitly. Note that `chaptering` is structurally
   identical to the Slice 2 `extracting` transient — both are
   forced by Postgres (a transaction cannot remain open across a
   multi-minute LLM call). The `complete_segmentation` RPC
   atomically performs INSERT-N-segments + UPDATE-status, satisfying
   the SPEC's "single transaction" constraint at the data-write
   boundary.
3. **§Background job architecture state diagram (~line 19):**
   revise the diagram to show `segmenting → chaptering → summarizing`.

### Q2 (SPEC half) — rewrite Stage 4 failure-mode line

**Current text (~line 250):** "LLM returns a chapter with
`start_time_seconds >= end_time_seconds`: Zod validator rejects,
same handling."

Under the T-token scheme the LLM never emits seconds — it emits
`[Tn]` token references. The failure mode described is structurally
unreachable.

**Replacement:** "Sub-second utterance rounding can produce
`Math.floor(startUtt.start / 1000) === Math.ceil(endUtt.end / 1000)`
at the worker's T-token-to-seconds resolution step. The worker
coerces `endSec = startSec + 1` to satisfy the
`end_time_seconds > start_time_seconds` CHECK constraint and emits
a `logger.warn`. The row does not fail."

### Q3 — lock 24K char chunk target as intentional

**§Stage 4 chunking section.** Add:

> `CHUNK_MAX_CHARS = 24_000` is the intentional conservative target
> (~6.5K tokens at ~3.7 chars/token average). The ~20% margin under
> the 8K-token budget guards against tokenizer variance and ensures
> the system prompt + chunk + structured output overhead stays well
> within the model's input window. Cost overhead at v1 volume
> (~24 meetings/year, ~12 chunks/meeting) is negligible.

### Q4 — document all-chunks-zero-markers as failure

**§Stage 4 Failure modes.** Add to the failure list:

> Step 2 returns zero markers across every chunk of the transcript:
> meeting fails. Per-chunk zero markers remains acceptable (existing
> behavior); full-transcript zero indicates an ASR or pipeline fault.
> A real meeting always produces at least one `PROCEDURE` marker
> (call-to-order, adjournment). Manual reset required.

### Suggested commit

`docs(spec): close Slice 3 audit questions Q1-Q4`

## Session ordering

1. **SPEC update PR (Work stream B)** — small, low-risk, no re-audit needed.
2. **Code fixes (Work stream A)** — re-audit recommended; F1 touches
   retry semantics, worth verifying the fix doesn't introduce
   regression in the failure-path handling.
3. **Wont-fix promotion** — separate skill invocation. See companion
   brief.

## Wont-fix items

Four items from the source audit were triaged as wont-fix and
promoted to `_known-non-issues.md`:

- **Q5** — TRANSCRIPT_EXCERPT_MAX_LEN worker-side cap → NI-012
- **Q6** — redundant `segments_meeting_id_idx` → NI-013
- **Q7** — speculative barrel exports in segmentation package → NI-014
- **Q11** — chunkLines admits oversized single line → NI-015

See `docs/audits/_known-non-issues.md` for reasoning and revisit
triggers per entry.

## Out of scope (reference)

Wont-fix items handled in companion brief: Q5, Q6, Q7, Q11.
Promoted to NI-012 through NI-015.
