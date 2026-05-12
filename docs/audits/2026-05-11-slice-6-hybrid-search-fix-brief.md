---
date: 2026-05-11
source_audit: docs/audits/2026-05-11-slice-6-hybrid-search.md
commit_range: 2ab1d4e..cbb2951
findings_addressed: F1, F2
questions_addressed: Q1, Q2, Q3
reopen_candidates: NI-009
fix_now_count: 3
wont_fix_count: 3 audit symbols collapsing to 2 NI entries (NI-020, NI-021)
defer_count: 1 (NI-009 reopen → separate slice)
no_action_count: 1 (Q3)
---

# Fix-brief — Slice 6 hybrid-search audit

Triage outcome for `docs/audits/2026-05-11-slice-6-hybrid-search.md`.
Read alongside the source audit for full evidence and verification
notes; this brief is the CC-applicable instruction set.

## Fix now

### F1 — Align embedding-input separator to SPEC

**Site:** `packages/shared/src/embedding/inputs.ts:9` and
`packages/shared/src/embedding/inputs.test.ts:5-13`.

**Change:** Replace `parts.join('\n').trim()` with `parts.join(' ').trim()`.
Update the matching assertion in the test (the expected concatenated
output changes by one whitespace character).

**Reason:** SPEC.md:558 specifies single-space concatenation for the
semantic-arm input (`title || ' ' || description || ' ' || transcript_excerpt`).
Implementation drifted to `\n` during build without SPEC amendment or
ADR. Per CLAUDE.md §8, SPEC is the architecture lock — align code to SPEC.
Retrieval-quality impact of the change is negligible (both characters
are whitespace boundaries to the OpenAI tokenizer); the fix is a
SPEC↔code reconciliation, not a quality fix.

**Verify:** `pnpm -F shared test` passes. `buildEmbeddingInput` has one
consumer, `apps/worker/src/embedding/run.ts` — re-run
`pnpm -F worker test` to confirm no downstream assertion breaks.

**Audit ID:** F1, confidence 82, severity MEDIUM.

### F2 — Drop redundant `src/**/*` from worker scripts tsconfig

**Site:** `apps/worker/tsconfig.scripts.json:8`.

**Change:**

```diff
-  "include": ["scripts/**/*", "src/**/*"],
+  "include": ["scripts/**/*"],
```

**Reason:** `apps/worker/tsconfig.json` already includes `src/**/*`.
The worker `typecheck` script runs both configs sequentially
(`tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json`), so every file
under `src/` is type-checked twice. The `src/**/*` entry in the scripts
include is not load-bearing — with `noEmit: true` and no `rootDir`,
transitive imports from `scripts/` into `../src/...` resolve and
type-check transparently.

**Verify:** `pnpm -F worker typecheck` passes. Both configs run; the
scripts config still resolves its `../src/...` imports through
transitive loading.

**Audit ID:** F2, confidence 85, severity LOW.

### Q1 — Replace SPEC.md:702 defensive-guard sentence with structural-bound note

**Site:** `SPEC.md:702` — Stage 9, Embedding pipeline failure modes,
"Length-bound violation" bullet.

**Current text (to remove):**

```
Length-bound violation: `text-embedding-3-small` has an 8,192 token
input cap. v1 segment lengths (title + description + transcript_excerpt)
are well below this. The handler validates input length defensively
before each API call as a guard.
```

**Replacement text:**

```
Length-bound coverage: `text-embedding-3-small` has an 8,192 token
input cap. v1 inputs are structurally bounded by `TITLE_MAX_LEN +
DESCRIPTION_MAX_LEN + TRANSCRIPT_EXCERPT_MAX_LEN` (set in
`packages/shared/src/embedding/inputs.ts`), well under 8K tokens via
the ~4-char-per-token proxy. The structural bound is the operative
contract. Revisit if any of those constants is raised or the
embedding model is changed.
```

**Reason:** Original sentence prescribed a runtime guard the handler
does not implement and cannot reach at v1 (inputs bounded upstream
to ~500 chars). Mirrors NI-012's "worker-side cap as operative
contract" reasoning. Path 2 of audit Q1 (drop the SPEC sentence,
ratify structural bounds as the contract).

**Verify:** Grep `defensively before each API call` across SPEC.md to
confirm zero remaining instances of the old phrasing.

**Audit ID:** Q1, verification confidence 70.

## Wont-fix items (promoted to NI-020 through NI-021)

Q2 produces two new entries via the `promote-to-non-issue` skill. Two
entries rather than three: the two `packages/shared/src/embedding/`
exports collapse under one barrel-pattern entry (mirrors NI-014); the
worker single-file export gets its own entry (mirrors NI-018 / NI-019).

### NI-020 — `packages/shared/src/embedding/` barrel speculative exports

**Symbols covered:**

- `OpenAIEmbeddingResponse` (type), `packages/shared/src/embedding/schemas.ts:27`, re-exported from `index.ts:5`
- `EmbeddingInputFields` (interface), `packages/shared/src/embedding/inputs.ts:1`, re-exported from `index.ts:3`

**Reasoning to paste into the `promote-to-non-issue` skill in CC:**

```
Source audit: docs/audits/2026-05-11-slice-6-hybrid-search.md (Q2).

Two exports from packages/shared/src/embedding/ have zero external
consumers today. OpenAIEmbeddingResponse is the inferred return
type of OpenAIEmbeddingResponseSchema.parse() and is used only
inside schemas.ts. EmbeddingInputFields is the parameter type of
buildEmbeddingInput and is used only inside inputs.ts. Both are
re-exported via the embedding/ barrel index.

This is the same shape as NI-014 (segmentation barrel speculative
exports). The accepted reasoning ports directly: barrel re-exports
do not ship dead code under tree-shaking, packages/shared is not
published, and trimming now means re-exporting later. The
NI-009 reopen candidate (second Edge Function revisit trigger
fired in Slice 6) is queued as a separate slice that intends to
pull packages/shared/src/embedding/ into the search Edge Function
via the npm: specifier path. At that point both exports become
load-bearing across runtime boundaries.

Revisit trigger: the NI-009 resolution slice ships. On success
(Deno-side import wiring succeeds and these symbols become
externally consumed), close NI-020 as Resolved. On failure (Deno
path permanently infeasible), re-evaluate trimming.
```

### NI-021 — `apps/worker/src/embedding/openai.ts` single-file speculative export

**Symbol covered:** `OpenAIEmbedderOptions` (interface), `apps/worker/src/embedding/openai.ts:23`.

**Reasoning to paste into the `promote-to-non-issue` skill in CC:**

```
Source audit: docs/audits/2026-05-11-slice-6-hybrid-search.md (Q2).

OpenAIEmbedderOptions is declared as `export interface` but is
referenced only at line 49 of the same file. Not barrel-re-exported.

Same shape as NI-018 (apps/web/src/lib/resolvers.ts) and NI-019
(apps/web/src/lib/sort-segments.ts): per-file speculative exports
inside new module surface. Reasoning ports directly — the export
keyword has no runtime cost (tree-shaking, no publication), and
trimming it means re-exporting later if a test, sibling module,
or refactor needs the options shape. apps/worker/src/embedding/
is a new module with one consumer; natural place to keep the
options surface accessible.

Revisit trigger: a second site imports OpenAIEmbedderOptions
(rather than redeclaring the shape), or the embedding module is
refactored. Close as Resolved at first external consumer; close
as Removed if the module is deleted entirely.
```

## Defer (separate slice)

### NI-009 reopen — `packages/shared` schemas not yet imported by Edge Functions

The second-Edge-Function revisit trigger fired in Slice 6.
`supabase/functions/search/index.ts` (the new Edge Function)
redefines the OpenAI embeddings-response Zod schema (lines 43-55)
and the `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` constants
(lines 21-22) inline rather than importing from
`packages/shared/src/embedding/`. The
`// @deno-types="npm:zod@3.23.8"` directive already at
`search/index.ts:15` indicates the `npm:` specifier path is
operative — the original NI's "Deno-compatible import paths are
non-trivial" reasoning has been partially eroded by Supabase Edge
Function tooling maturing since the NI was written.

**Decision:** Withdraw NI-009 in a separate slice performing the
Deno-side import wiring. Not folded into this fix-brief because the
work is a runtime-touching refactor (Edge Function must redeploy and
search round-trip must verify), not a doc-edit pass. Folding would
inflate this apply-pass surface and couple a refactor to a fix-brief.

**Action 1 — SPEC.md §Backlog addition.** Append the following entry
to the §Backlog section:

```
- **NI-009 resolution — Deno-side import wiring for `packages/shared`.**
  Replace inline OpenAI embeddings-response Zod schema and the
  EMBEDDING_MODEL / EMBEDDING_DIMENSIONS constants in
  supabase/functions/search/index.ts (lines 21-22, 43-55) with imports
  from packages/shared/src/embedding/. Use the npm: specifier path
  already established at search/index.ts:15 for Zod. Verify Edge
  Function redeploy and search round-trip end-to-end. On success,
  mark NI-009 as Resolved (manual registry edit per build-cycle.md
  routing). On infeasibility, document the Deno-side blocker and
  update NI-009 reasoning with a third-Edge-Function revisit trigger.
  Trigger: explicit pickup after Slice 6 wont-fix promotions are
  registered. Single-session CC slice; no SPEC changes anticipated
  beyond Backlog entry removal on resolution.
```

**Action 2 — manual registry edit.** Update NI-009 in
`docs/audits/_known-non-issues.md` Status from `Accepted` to
`Triggered — scheduled for resolution slice`. This is a manual CC
edit, not a `promote-to-non-issue` skill operation (the skill is
append-only; existing-NI status changes are manual per
build-cycle.md).

## No action

### Q3 — `DEFAULT_MATCH_COUNT` / `MAX_MATCH_COUNT` triplication

Three sites hardcode the same 20/50 pair under three different
constant names (`supabase/functions/search/index.ts:19-20`,
`apps/web/src/app/[publication]/search/page.tsx:11-12`, three
`limit least(match_count, 50)` occurrences in the migration).
Severity NIT. Centralization paths require Deno-side import wiring
(same dependency as NI-009 reopen). Accept the triplication at
single-tenant v1 scale; revisit naturally inside the NI-009
resolution slice (`SEARCH_DEFAULT_MATCH_COUNT` /
`SEARCH_MAX_MATCH_COUNT` constants fold into the same wiring).

No code or registry change in this apply pass.

## Apply order

1. **F2** — `apps/worker/tsconfig.scripts.json:8` edit. Verify
   `pnpm -F worker typecheck`.
2. **F1** — `packages/shared/src/embedding/inputs.ts:9` edit +
   test update. Verify `pnpm -F shared test` and `pnpm -F worker test`.
3. **Q1** — SPEC.md:702 paragraph replacement. Verify grep cleanup.
4. **Commit** steps 1-3 in one PR (`docs+fix: slice 6 audit triage —
   F1, F2, Q1`).
5. **Q2 promotes** — separate CC operation invoking the
   `promote-to-non-issue` skill twice (NI-020 then NI-021), each
   with the reasoning blocks above. Append-only on
   `_known-non-issues.md`.
6. **NI-009 reopen artifacts** — manual SPEC.md §Backlog append +
   manual NI-009 status edit in `_known-non-issues.md`. Same commit
   or follow-up; doc-only.

## PR gate expected state

`pnpm -r typecheck` / `pnpm -r test` / `pnpm -r lint` /
`pnpm format:check` all green. Test count remains at 158 + 2
skipped; the F1 test assertion edit is a string change, not a
count change.
