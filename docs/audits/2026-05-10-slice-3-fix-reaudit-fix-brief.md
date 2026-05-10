---
date: 2026-05-10
scope: Triage outcomes from 2026-05-10-slice-3-fix-reaudit.md audit
source_audit: docs/audits/2026-05-10-slice-3-fix-reaudit.md
decisions_in_scope: F1, F2, Q1, Q2
fix_now_count: 3
no_action_count: 1
wontfix_count: 0
---

# Fix brief — Slice 3 fix-reaudit triage

Three items triaged fix-now (two SPEC edits, one code edit). One
item triaged no-action (current state is consistent). No wont-fix
items, no NI promotions from this triage.

## Work stream A — SPEC update (one docs-only commit)

Single commit. No code change. Closes F1 and F2.

### F1 — add 429 to §Stage 4 retry-policy line

**File:** `SPEC.md:253`

The F1 fix from yesterday's brief scoped `withRetry` to
`APIConnectionError | InternalServerError | RateLimitError`.
`RateLimitError` corresponds to HTTP 429, which is 4xx — not 5xx.
SPEC line 253 reads "Anthropic API timeout or 5xx" and now
disagrees with the code.

**Edit:** replace

> Anthropic API timeout or 5xx: worker retries up to 3× with
> exponential backoff (1s, 4s, 16s), then fails the row.

with

> Anthropic API timeout, 429, or 5xx: worker retries up to 3×
> with exponential backoff (1s, 4s, 16s), then fails the row.

Vendor-agnostic HTTP-status framing chosen over SDK class names
to keep SPEC durable across SDK upgrades.

### F2 — fix step attribution in §Stage 4 failure-mode bullet

**File:** `SPEC.md:255`

The pre-existing failure-mode bullet says "Step 2 returns zero
markers for a chunk." Per SPEC §Stage 4 Method (lines 216-217),
Step 2 returns end-tokens, not markers — Step 1 is the marker
extraction step. The Q4 closure committed yesterday added an
adjacent bullet correctly attributing per-chunk marker emission
to Step 1, and its parenthetical "Per-chunk zero markers remains
acceptable (above)" only parses correctly if the prior bullet
also says Step 1.

**Edit:** change "Step 2" to "Step 1" on line 255. One word.

### Suggested commit

`docs(spec): close fix-reaudit findings F1 + F2`

## Work stream B — code fix (one commit)

### Q2 — drop unreachable `idx < 0` clause from `lookupTToken`

**File:** `packages/shared/src/segmentation/t-tokens.ts:62`

`parseTTokenIndex` (extracted yesterday by Q8) can only return
`null` or a non-negative integer — the regex `/^\[T(\d+)\]$/`
matches digits only with no sign character, and the
`Number.isInteger` filter rejects non-integer paths. Therefore
the `idx < 0` clause in `lookupTToken`'s guard
`if (idx === null || idx < 0 || idx >= lookup.length)` cannot
fire.

CLAUDE.md says "don't add error handling for scenarios that
can't happen." The other two clauses do real work
(`idx === null` is parse-failure, `idx >= lookup.length` is
upper-bound). Dropping `idx < 0` removes dead code without
weakening the guard.

**Edit:** in `lookupTToken`, change

```typescript
if (idx === null || idx < 0 || idx >= lookup.length) {
  return null;
}
```

to

```typescript
if (idx === null || idx >= lookup.length) {
  return null;
}
```

Existing tests for `lookupTToken` should continue to pass
unchanged. No new test needed (the dead branch had no test
coverage to remove).

### Suggested commit

`refactor(shared): drop unreachable idx < 0 clause in lookupTToken`

## No-action items (recorded for traceability)

### Q1 — §Stage 5 enum line synchronization convention

**File:** `SPEC.md:264-279`

The audit asked whether the §Stage 5 "pass 1 schema (as built)"
enum line should track the live state machine (current behavior
since yesterday's commit added `chaptering` to it), freeze to
scaffold-migration ground truth with a "subsequent slices add..."
pointer, or have the section heading reworded.

**Decision:** keep current behavior (synced to live state
machine). The line's existing cross-reference ("matches the state
machine in §Background job architecture") and the Slice 3
schema-deltas subsection at line 355 together provide sufficient
provenance for a careful reader. Revisit only if a reader
surfaces actual confusion.

No edit. No NI promotion. Recorded here for triage traceability.

## Wont-fix items

None.

## Session ordering

1. **SPEC + code commits (Work streams A and B)** — small enough
   to ship as two commits in one CC session. Plan mode optional.
2. **No re-audit recommended** — F1 and F2 are docs-only edits
   inside text the prior audit already verified; Q2 is a
   one-line dead-code removal with existing test coverage on the
   live branches.

## Out of scope (reference)

No items deferred. No items triaged as wont-fix. The full audit
was resolved by this brief.

## Companion

No `2026-05-10-slice-3-fix-reaudit-wontfix-brief.md` exists.
Per `docs/audits/README.md`, wont-fix briefs are not committed —
and in this triage there were no wont-fix items at all. The
"Wont-fix items" section above is empty by design.
