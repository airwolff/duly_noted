---
date: 2026-05-11
scope: Slice 6 — hybrid search (Postgres FTS + pgvector + RRF) and OpenAI embeddings pipeline
commit_range: 2ab1d4e..cbb2951
head_sha: cbb29519b7e19455d268c6b58347d46226308c05
prior_audit: 2026-05-10-slice-5-reader-ui-fix-reaudit.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 2
questions_count: 3
findings_dropped_by_verification: 3
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 6 hybrid search

Cold-reviewer audit of Slice 6 work since the Slice 5 reader-UI
re-audit closed. Range covers 20 commits across the
`slice-6-hybrid-search` branch: schema migration, embedding pipeline
in `apps/worker`, search Edge Function, search route in `apps/web`,
new ADRs 0021/0022 (and ADR 0020 superseded), CLAUDE.md and SPEC.md
amendments, and the per-board cron-horizon migration that landed in
the same branch.

## Mechanical pass results

| Pass | Result | Notes |
| ---- | ------ | ----- |
| `pnpm -r typecheck` | PASS | All 5 workspaces clean; worker runs both `tsc --noEmit` and `tsc --noEmit -p tsconfig.scripts.json`. |
| `pnpm -r test` | PASS | 158 tests passed, 2 skipped (web 37, worker-cron 26, worker 28, shared 56, db 2 + 2 RLS skipped). Includes new `embedding/openai.test.ts` (5), `embedding/run.test.ts` (6), `embedding/inputs.test.ts`, `embedding/schemas.test.ts`. |
| `pnpm -r lint` | PASS | All 5 workspaces clean. |
| `pnpm format:check` | PASS | Repo-wide Prettier clean. |
| `git diff --shortstat 2ab1d4e..HEAD` | 40 files, 4784 / -79 | Slice 6 + per-board horizon (committed together on the branch). Includes the 2703-line implementation plan at `docs/superpowers/plans/2026-05-11-slice-6-hybrid-search.md` — excluded from review surface (local plan artifact). |
| TODO/FIXME/XXX grep (changed files) | clean | none. |
| `console.*` grep (non-worker) | clean | New `console.error` calls live only in `supabase/functions/search/index.ts` (4 sites) — Edge Function server-side logging, allowed. |
| Hardcoded URL grep | clean | Only `https://api.openai.com/v1/embeddings` (worker + Edge Function — vendor endpoint) and the existing YouTube Data API URLs in `apps/worker-cron/src/youtube.ts`. |
| Secret-shaped strings | clean | none. |
| File size | clean | Largest new source file is the slice-6 migration at 375 LOC (mostly SQL); largest TS file is `embedding/run.test.ts` at 185 LOC. No new source file > 200 LOC. |
| Test ratio | healthy | New source files (`openai.ts` 104, `run.ts` 125, `inputs.ts` 14, `schemas.ts` 27) paired with tests (`openai.test.ts` 96, `run.test.ts` 185, `inputs.test.ts` 30, `schemas.test.ts` 38). The Edge Function `search/index.ts` has no unit tests — consistent with the `asr-webhook` precedent (no Edge Function test harness exists). |

## Findings

### F1 — `buildEmbeddingInput` joins with `\n`, SPEC specifies single-space concatenation

- **Severity:** MEDIUM
- **Source:** P1 (SPEC compliance)
- **File:line:**
  - `packages/shared/src/embedding/inputs.ts:9`
  - `packages/shared/src/embedding/inputs.test.ts:5-13` (test ratifies the deviation)
- **Finding:** The shared embedding-input builder concatenates `title`, `description`, and `transcript_excerpt` with newline separators (`parts.join('\n').trim()`). SPEC.md §"Slice 6 schema deltas" line 558 explicitly specifies the semantic-arm input format as `title || ' ' || description || ' ' || transcript_excerpt` — single space. The implementation plan at `docs/superpowers/plans/2026-05-11-slice-6-hybrid-search.md` (lines 699, 757) also specifies newline, so the plan + code are internally consistent, but the deviation from SPEC is unrecorded — no ADR amendment, no SPEC update.
- **Evidence:**
  ```ts
  // packages/shared/src/embedding/inputs.ts:7-13
  export function buildEmbeddingInput(fields: EmbeddingInputFields): string {
    const parts = [fields.title.trim(), fields.description.trim(), fields.transcript_excerpt.trim()];
    const joined = parts.join('\n').trim();
    if (joined === '') {
      throw new Error('buildEmbeddingInput: cannot build an empty input');
    }
    return joined;
  }
  ```
  ```
  # SPEC.md:558
  The semantic arm embeds the unweighted concatenation
  `title || ' ' || description || ' ' || transcript_excerpt`;
  weights are a lexical-arm-only concept.
  ```
- **Verification reasoning:** Verifier confirmed both sides of the divergence by direct file reads. The SPEC line is unambiguous about single-space concatenation and is contrasted in the same paragraph with the lexical-arm `setweight ||` tsvector concatenation (a different concept), so the SPEC author was deliberate about the separator. Neither ADR 0021 nor ADR 0022 amends this. The retrieval-quality difference between `\n` and ` ` for OpenAI `text-embedding-3-small` is small in practice (the tokenizer handles both as whitespace boundaries), so the bug is in SPEC↔plan↔code reconciliation, not in user-visible search quality. Confidence 82.
- **Confidence:** 82
- **Fix shape:** either (a) change `inputs.ts:9` to `parts.join(' ')` and update the matching test, or (b) amend SPEC.md:558 to ratify newline as the deliberate choice. Either remediation closes the discrepancy.

### F2 — `apps/worker/tsconfig.scripts.json` double-includes `src/**/*`, doubling typecheck work

- **Severity:** LOW
- **Source:** P4 (dead code / config audit)
- **File:line:** `apps/worker/tsconfig.scripts.json:8`
- **Finding:** `apps/worker/tsconfig.scripts.json` declares `"include": ["scripts/**/*", "src/**/*"]`, while `apps/worker/tsconfig.json` already includes `src/**/*`. The worker's `typecheck` script (`package.json:10`) runs `tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json`, so every file under `src/` is type-checked twice. The `src/**/*` entry in the scripts include is not required for the scripts to compile — TypeScript resolves transitive imports automatically; with `noEmit: true` and no `rootDir`, out-of-include transitive imports load and type-check transparently.
- **Evidence:**
  ```jsonc
  // apps/worker/tsconfig.scripts.json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "noEmit": true, "lib": ["ES2022"], "types": ["node"] },
    "include": ["scripts/**/*", "src/**/*"],
    "exclude": ["dist", "node_modules", "**/*.test.ts"]
  }
  ```
  ```jsonc
  // apps/worker/tsconfig.json — include line
  "include": ["src/**/*"]
  ```
  ```jsonc
  // apps/worker/package.json:10
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json"
  ```
- **Verification reasoning:** Verifier confirmed the double-include directly. No other workspace defines a `tsconfig.scripts.json`, so there's no repo precedent. Severity LOW: the duplicated pass adds at most a few seconds on a small worker source tree, and produces no incorrect output. Confidence 85.
- **Confidence:** 85
- **Fix shape:** drop `"src/**/*"` from `tsconfig.scripts.json:8`, leaving `"include": ["scripts/**/*"]`. Re-run `pnpm -F worker typecheck` to confirm the scripts still resolve their `../src/...` imports.

## Questions for human

### Q1 — SPEC mandates a defensive 8K-token input-length validation that the worker does not implement

- **Question:** SPEC.md:702 (Stage 9, Embedding pipeline failure modes, bullet "Length-bound violation") states: *"`text-embedding-3-small` has an 8,192 token input cap. v1 segment lengths (title + description + transcript_excerpt) are well below this. The handler validates input length defensively before each API call as a guard."* The handler does not implement this guard. Inputs are structurally bounded by `TITLE_MAX_LEN` + `DESCRIPTION_MAX_LEN` + `TRANSCRIPT_EXCERPT_MAX_LEN` (500 chars, per NI-012) — well under 8K tokens at v1. The guard cannot fire on any real input today. Options: (a) drop the SPEC sentence and accept structural bounds as the operative contract, mirroring the NI-012 worker-side-cap reasoning; (b) add a one-line defensive check in `openai.ts` before the fetch call (rough token estimate or character-length proxy); (c) defer and create an NI entry. The original SPEC framing is "defensive" — the guard's load-bearing weight is near zero. The recommendation hinges on whether the project wants SPEC-stated guards always implemented or treats "defensive" as opt-in.
- **Evidence:**
  ```
  # SPEC.md:702
  Length-bound violation: `text-embedding-3-small` has an 8,192 token
  input cap. v1 segment lengths (title + description + transcript_excerpt)
  are well below this. The handler validates input length defensively
  before each API call as a guard.
  ```
  No corresponding check in `apps/worker/src/embedding/openai.ts:52-100` (only post-response vector-count assertion at line 80) or `apps/worker/src/embedding/run.ts:84-125`. `packages/shared/src/embedding/inputs.ts` has no cap either. NI-012 documents the parallel "worker-side cap as operative contract" reasoning for `transcript_excerpt`.
- **Why this needs human input:** SPEC stipulates a guard the structural input bounds make unreachable. Triage choice: implement-the-SPEC, drop-the-SPEC-sentence, or NI-defer. The verifier flagged this Question-routable explicitly (`should_be_question_not_finding: true`). Confidence 70.
- **Verification confidence:** 70

### Q2 — New `packages/shared/embedding/` and `apps/worker/src/embedding/openai.ts` introduce three speculative exports that match the NI-014 / NI-018 / NI-019 pattern

- **Question:** Three exported symbols in the new embedding module have zero consumers outside their declaring file:
  - `OpenAIEmbeddingResponse` (type) at `packages/shared/src/embedding/schemas.ts:27`, re-exported from `packages/shared/src/embedding/index.ts:5`. Zero importers.
  - `EmbeddingInputFields` (interface) at `packages/shared/src/embedding/inputs.ts:1`, re-exported from `index.ts:3`. Used only inside `inputs.ts` as the parameter type of `buildEmbeddingInput`; no external consumer.
  - `OpenAIEmbedderOptions` (interface) at `apps/worker/src/embedding/openai.ts:23`. Used only at line 49 of the same file. Not barrel-re-exported.

  This is the same structural pattern as NI-014 (segmentation barrel speculative exports), NI-018 (`apps/web/src/lib/resolvers.ts` speculative exports), and NI-019 (`apps/web/src/lib/sort-segments.ts` speculative export). All three NIs are Accepted wont-fixes. The decision is: extend the NI pattern to the embedding module (likely as NI-020 / NI-021 / NI-022 in triage) or trim now.
- **Evidence:**
  - `grep -rn 'OpenAIEmbeddingResponse' /Users/andywolff/Desktop/projects/duly_noted` returns only the declaration and the index re-export.
  - `grep -rn 'EmbeddingInputFields'` returns only the declaration, the same-file use, and the index re-export.
  - `grep -rn 'OpenAIEmbedderOptions'` returns only the declaration and the same-file use.
  - NI-014 reasoning: "Barrel files do not ship dead code (tree-shaking handles that), and the package is not published. Trimming now means re-exporting later." Same logic applies here.
- **Why this needs human input:** The verifier explicitly flagged this as Question-routable (`should_be_question_not_finding: true`) because it's a triage call between extending the NI pattern and trimming. None of the three NI revisit triggers cover this directly — NI-014's trigger was scoped to segmentation, NI-018/019 are per-file. The decision drives whether `_known-non-issues.md` grows three more entries or the code drops three lines.
- **Verification confidence:** 85 (verified=true; verifier recommended Question routing despite the high confidence because the disposition is triage, not a clear defect)

### Q3 — `DEFAULT_MATCH_COUNT = 20` and the max-50 ceiling are triplicated across the Edge Function, web page, and the SQL function

- **Question:** The same `20` / `50` pair appears in three places with three different constant names:
  - `supabase/functions/search/index.ts:19-20`: `const DEFAULT_MATCH_COUNT = 20; const MAX_MATCH_COUNT = 50;`
  - `apps/web/src/app/[publication]/search/page.tsx:11-12`: `const DEFAULT_MATCH_COUNT = 20; const SHOW_MORE_MATCH_COUNT = 50;`
  - `supabase/migrations/20260511184530_slice_6_search_schema.sql:327, 336, 367`: three occurrences of `limit least(match_count, 50)`.

  A drift between any pair (e.g. web sends 60, Edge Function caps at 50 silently, SQL caps again at 50) is observable only at runtime and may surprise the next contributor who tunes one site. Centralizing `DEFAULT = 20`, `MAX = 50` in `packages/shared/embedding/` (or a new `packages/shared/search/`) would tie the contract together — at the cost of one more shared-package consumer and matching it on the SQL side anyway (hardcoded ceiling per RPC). Decide: (a) accept the triplication as fine at v1, (b) centralize in `packages/shared`, (c) treat the SQL ceiling as the contract and have TypeScript callers infer from a Zod schema imported from shared.
- **Evidence:** (see Files cited above.)
- **Why this needs human input:** NIT severity (sub-80 initial confidence, no verification run per the LOW/NIT carry-confidence rule). The question is about whether to centralize for future maintainability or accept the duplication at single-tenant scale. Either answer is defensible.
- **Verification confidence:** 75 (NIT, sub-80 floor → Question)

## Reopen candidates

### NI-009 — `packages/shared` schemas not yet imported by Edge Functions

- **Original revisit trigger:** "a second Edge Function lands that needs the same shapes (inbound public API, second webhook receiver, signed-URL minter). At that point the duplication cost crosses the import-wiring cost and shared imports become correct."
- **What changed:** Slice 6 lands `supabase/functions/search/index.ts` — the second Edge Function. It needs the same OpenAI-response shape that `apps/worker` consumes via `packages/shared/src/embedding/schemas.ts`. The Edge Function instead redefines the schema inline (`supabase/functions/search/index.ts:43-55`) and redefines `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` inline (lines 21-22).
- **Worth reconsidering because:** the NI's revisit condition has fired. The duplication is real: three constants and one Zod schema are now maintained twice — once for the worker (Node-side, importing from the shared package) and once for the Edge Function (Deno-side, inline). The original NI-009 reasoning (Deno-compatible npm-workspace import paths are non-trivial) still has technical force, but the second-Edge-Function trigger explicitly anticipated this moment. User has three triage paths: (a) withdraw NI-009 and prioritize wiring `packages/shared` for Deno (likely via the `npm:` specifier supported by Supabase Edge Functions) — net effect: drop the inline schema/constants in `search/index.ts`; (b) update NI-009's reasoning to acknowledge the Deno-side import-wiring cost is still worse than the duplication at two consumers, with a new trigger ("third Edge Function"); (c) leave NI-009 unchanged and accept the duplication. The `// @deno-types="npm:zod@3.23.8"` directive already in `search/index.ts:15` suggests `npm:` specifiers are the path forward if (a) wins.

## What NOT to fix (this audit)

- **`complete_embedding` does not validate that every `segment_id` in the JSON array corresponds to a real segment row.** Verifier disproved (confidence 88, verified=false). SPEC.md:568 requires *atomicity* ("partial writes are impossible"), which the implementation satisfies via the implicit per-RPC transaction. The only legitimate caller is `apps/worker/src/embedding/run.ts`, which constructs `segment_id`s from the claim-RPC return value — server-supplied, not client input. The RPC is `GRANT EXECUTE … to service_role` only. Adding a row-count check on the segments update would be defense-in-depth gold-plating, not a correctness fix.
- **`search_segments` tenant isolation depends entirely on Slice 5 membership-aware RLS recursion across joined tables.** Verifier disproved (confidence 18, verified=false). This is the project's locked architecture per ADR 0021 §40-41 ("Existing membership-aware RLS on `segments` … governs search results without policy duplication") and CLAUDE.md §6 ("RPCs called from authenticated user surfaces must NOT use `SECURITY DEFINER`. They run as the caller so the membership-aware RLS policies … gate the result set"). The proposed defense-in-depth predicate (`WHERE m.publication_id IN (SELECT … FROM memberships)`) is exactly the duplication ADR 0021 deliberately rejects.
- **HNSW index on `segments.embedding` lacks a `WHERE embedding IS NOT NULL` partial-index predicate.** Verifier disproved (confidence 88, verified=false). pgvector HNSW explicitly does not index NULL vectors at build time — the "wastes space" framing is factually incorrect. The Supabase canonical hybrid-search reference that Slice 6 follows uses no partial predicate either; SPEC.md:562 specifies the index verbatim with no partial predicate.
- **`render.yaml` does not declare `ANTHROPIC_API_KEY` in any env var group.** Pre-existing Slice 4 carryover (header comment at `render.yaml:35-37` acknowledges this). Slice 6 changes `render.yaml` only to add `OPENAI_API_KEY` to the worker group and `ingest_since_days`-related comments — it does not introduce or worsen the Anthropic-key gap. Not a Slice 6 defect; if it should be addressed, it's a separate Slice 4 reopen and not in this audit's scope.
- **Search Edge Function uses `.length(1)` while shared worker Zod schema uses `.min(1)`.** Asymmetric but intentional (single-input query path embeds exactly one string; worker batches up to 100). Verified confidence 30. Not a defect.

## Suggested fix order

1. **F1** — fix the embedding-input concatenator. One-character code change in `inputs.ts:9` and a matching test update (or, alternatively, a one-character SPEC edit at line 558). The path of least drift is to align the code with SPEC since SPEC is the architecture lock per CLAUDE.md §8.
2. **F2** — drop `"src/**/*"` from `apps/worker/tsconfig.scripts.json:8`. Re-run `pnpm -F worker typecheck`.
3. **Q1** — decide: implement-the-SPEC defensive-length check, drop the SPEC sentence, or NI-defer (mirror NI-012 reasoning).
4. **Q2** — decide: extend the NI-014/018/019 pattern to the new embedding module (likely NI-020 through NI-022 entries) or trim the three speculative exports.
5. **Q3** — decide: centralize `DEFAULT_MATCH_COUNT=20` / `MAX_MATCH_COUNT=50` in `packages/shared` or accept the triplication.
6. **NI-009 reopen** — answer the three-path triage in this audit's "Reopen candidates" section.

F1 and F2 are mechanical; everything else routes to triage.

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 1 |
| LOW | 1 |
| NIT | 0 |
| **Total findings** | **2** |
| Questions | 3 |
| Reopen candidates | 1 (NI-009) |
| Findings dropped by verification | 3 (complete_embedding stale-id, search_segments RLS, HNSW partial predicate) |
| Findings suppressed by registry | 0 |

Mechanical posture: typecheck / test / lint / format:check all green; 158 tests pass with 2 skipped (the RLS suite stays skipped per Slice 5 disposition). Slice 6 lands a substantial surface (40 files, 4784/-79) covering migration, embedding pipeline, search Edge Function, search route, two new ADRs, SPEC and CLAUDE.md amendments — and audits to two real findings plus three triage-routable questions. The two findings are both mechanical (one-character code edit each); the three questions are decision-calls about SPEC↔code reconciliation, accepted-pattern continuity, and constant-locality. The NI-009 reopen candidate is the most consequential downstream item: the second Edge Function trigger has fired and the registry entry needs an updated revisit condition or an explicit "do the import wiring" decision.
