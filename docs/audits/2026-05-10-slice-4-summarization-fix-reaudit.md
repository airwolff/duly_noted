---
date: 2026-05-10
scope: Slice 4 summarization fix-application + SPEC refinement + audit-trail commits
commit_range: 70c81ff..0b18af9
head_sha: 0b18af9
prior_audit: 2026-05-10-slice-4-summarization.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 1
questions_count: 1
findings_dropped_by_verification: 4
findings_filtered_by_known_non_issues: 0
---

# Audit — Slice 4 summarization fix-reaudit

Four commits in scope, in chronological order:

- `b0fb358` — `fix(worker): enrich summarization length-bound failures with actual length` — adds `parseSummaryWithLengthDetail` helper at `apps/worker/src/pipeline/summarize.ts:91-112` that wraps Zod `too_big` / `too_small` issues with a message containing the actual length and the configured `[SUMMARY_MIN_CHARS, SUMMARY_MAX_CHARS]` bounds; non-length Zod errors pass through unchanged. New test in `summarize.test.ts` asserts the enriched message reaches `last_error`.
- `013e58d` — `fix(worker): enrich segmentation length-bound failures with actual length` — parallel `parseStep3WithLengthDetail` helper at `apps/worker/src/pipeline/segment.ts:113-136` covering `TITLE_MAX_LEN` / `DESCRIPTION_MAX_LEN` violations on the step-3 output. New test in `segment.test.ts` asserts the title-bound branch.
- `1a8a895` — `docs(spec): refine Slice 4 summarization to match built shape` — rewrites SPEC §Stage 6 §State transition to describe the two-RPC `claim_summarizing_meeting()` / `complete_summarization()` pair (replacing the original single-UPDATE state-transition example), refines §Stage 6 §Hallucination guardrails to document the v1 entity-grounding deviation from the full Oberoi pattern, adds Backlog B6 (speaker-identification pre-pass + board member roster), and adds an Enum-addition + RPC subsection to §Slice 4 schema deltas.
- `0b18af9` — `docs(audits): slice 4 summarization audit, fix-brief, and 2 wont-fix entries` — commits `2026-05-10-slice-4-summarization.md` (the source audit), its fix-brief, and appends NI-016 / NI-017 to `_known-non-issues.md`.

## Mechanical pass results

| Check                                | Result                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm -r typecheck`                  | clean (5 workspaces)                                                            |
| `pnpm -r lint`                       | clean (5 workspaces)                                                            |
| `pnpm -r test`                       | 92 tests passing (50 shared / 2 db / 23 worker-cron / 17 worker / 0 web)        |
| `pnpm format:check`                  | clean                                                                           |
| `git diff --shortstat 70c81ff..HEAD` | 8 files changed, 348 insertions(+), 17 deletions(-)                             |
| TODO/FIXME/XXX in changed files      | none                                                                            |
| `console.*` in scope (worker exempt) | none                                                                            |
| Hardcoded URLs in changed src        | none                                                                            |
| Secret-shaped strings                | none                                                                            |
| `.env*` literal references           | none                                                                            |
| New files > 500 LOC                  | 0 (no new source files; only modifications + 3 docs files)                      |
| Existing files growing > 200 LOC     | 0                                                                               |
| Source vs test files added           | 0 source / 0 test — modifications only; +29 LOC in segment.test, +7 LOC summarize.test |

The mechanical surface is clean. Test count rose from 91 → 92 (one new test in `segment.test.ts`; `summarize.test.ts` modifies an existing test rather than adding one). The F1 fix is purely within-handler error-message enrichment — no DB schema changes, no new queries, no state-machine changes, no new vendor surfaces.

## Findings

### F1 — SPEC.md staleness on `summarizing → review → published` after Stage 6 refinement

- **Severity:** MEDIUM
- **Source:** P1 (verified by direct read; confidence 95)
- **File:line:** `SPEC.md:26` (architecture overview) and `SPEC.md:119` (Stage-1 open-items closure)
- **Finding:** Commit `1a8a895` refined SPEC §Stage 6 to land on `summarizing → published` directly (line 295: "The single user-facing transition is `summarizing → published`. The `review` enum slot is reserved for the future operator review UI slice (Backlog B4); no row sits in `review` at v1.") and rewrote the §State transition section to describe the actual two-RPC pattern. Two upstream SPEC sections that mention the same flow were not propagated and still describe the legacy `summarizing → review → published` shape, contradicting both the refined Stage 6 text and the implementation in the `complete_summarization` RPC.
- **Evidence:**
  - `SPEC.md:26` (verbatim): "Worker picks up `segmenting` rows, runs the LLM segmentation pass, advances to `summarizing`. Picks up `summarizing` rows, runs the meeting-summary pass, auto-advances `summarizing → review → published` in a single transaction. Operator review gate at `review → published` is deferred to a future slice (see Backlog B4); the `review` state slot is preserved in the enum for that slice."
  - `SPEC.md:119` (verbatim): "~~Operator review step inclusion sets the `review` state semantics.~~ — closed in Stage 6 below: v1 auto-advances `summarizing → review → published`. Operator review gate deferred (Backlog B4)."
  - Refined `SPEC.md:295` (the source of truth Stage 6 now sets): "The single user-facing transition is `summarizing → published`. The `review` enum slot is reserved for the future operator review UI slice (Backlog B4); no row sits in `review` at v1."
  - `supabase/migrations/20260510141247_slice_4_summarization_schema.sql:107-112` (the implementation): `update public.meetings set summary = p_summary, summary_generated_at = now(), status = 'published' where id = p_meeting_id and status = 'summarizing_inflight';` — direct transition to `published`, never visiting `review`.
- **Verification reasoning:** Both lines were read directly. Both are still present in `SPEC.md` at HEAD `0b18af9`. Both contradict §Stage 6's refined text (which `1a8a895` rewrote in the same commit) and the migration's actual SQL. CLAUDE.md §8 says "If `SPEC.md` and this file conflict, `SPEC.md` wins for architecture" — internal SPEC self-contradictions undermine that primacy. Neither line is in `_known-non-issues.md`.
- **Confidence:** 95.

## Questions for human

### Q1 — NI-016 reasoning text references a non-existent `'segmenting_inflight'` enum value

- **File:line:** `docs/audits/_known-non-issues.md:165`
- **Question:** NI-016's reasoning paragraph reads: "The complete-path RPCs (`complete_segmentation`, `complete_summarization`) carry `WHERE status = 'segmenting_inflight'` / `WHERE status = 'summarizing_inflight'` write-side idempotency guards." Slice 3's transient state is `'chaptering'`, not `'segmenting_inflight'` (verified in `supabase/migrations/20260509200337_slice_3_segmentation_schema.sql:25,182`). The acceptance reasoning still holds — the underlying wont-fix decision is correct — but the prose contains a factual transcription error introduced when promoting Q1 from the source audit (where the audit body correctly cites `chaptering`) to the registry. The registry's stated convention (file header lines 22-25) is "entries are never edited or deleted; they are promoted out … or marked `Withdrawn` when circumstances change." Neither escape hatch fits a typo correction. Three resolution paths exist: (a) leave as-is (typo immortalized but harmless because the underlying decision stands and the source audit text is correct); (b) treat the typo as a "circumstance change" warranting a Withdrawn-and-replaced entry that points to a corrected NI; (c) extend the registry convention to permit factual-error errata while preserving the never-rewrite-the-decision spirit.
- **Why this needs human input:** The registry's append-only / never-edit convention was set deliberately as the durability mechanism that lets audits trust the registry's prior decisions. Picking (a) accepts a documented typo; picking (b) churns an immutable record over a cosmetic issue; picking (c) loosens a convention. The choice is a project-level call about how strictly to enforce registry durability, not a code defect.
- **Evidence:**
  - `_known-non-issues.md:165` text quoted above.
  - `supabase/migrations/20260509200337_slice_3_segmentation_schema.sql:25` — `alter type public.meeting_status add value if not exists 'chaptering' before 'summarizing';`
  - `supabase/migrations/20260509200337_slice_3_segmentation_schema.sql:182` — `complete_segmentation` body: `set status = 'summarizing' … where id = p_meeting_id and status = 'chaptering';`
  - `2026-05-10-slice-4-summarization.md:69` (the source audit, correctly): "after a claim that transitioned `segmenting → chaptering`."

## Reopen candidates

None. The finding above does not reopen any wont-fix decision; the underlying NI-016 acceptance still stands.

## What NOT to fix (this audit)

- **F1 fix shape itself.** The `parseSummaryWithLengthDetail` / `parseStep3WithLengthDetail` helpers correctly satisfy SPEC §Stage 6 line 301 ("Length-bound violation: same handling — fails the row with `last_error` recording the actual length and the configured bounds"). Both `too_big` and `too_small` paths exercised by tests; both `title` and `description` field-selectors reachable in the segmentation helper. The `'unknown'` fallback in both helpers (defensive against non-object `raw` values that the structured-outputs constrained-decoding contract should make impossible) is acceptable hardening.
- **`as Record<string, string>` / `as { summary: string }` type assertions.** Both occur immediately after `typeof raw === 'object' && raw !== null && '<field>' in raw && typeof (raw as ...)[field] === 'string'` narrowing. CLAUDE.md §4 forbids `any`, not narrowing-followed-by-precise-cast; the helpers receive `unknown` and narrow per the rule.
- **No `abandon_summarizing_meeting` RPC.** Q1 in the source audit asked whether the unconditional `markFailed` failure path warrants a status-guarded abandon RPC; triage accepted as wont-fix → NI-016. The Slice 3 / Slice 4 failure-path asymmetry vs. the complete-path's `WHERE status = 'summarizing_inflight'` guard remains operationally safe under the single-Render-dyno deployment.
- **Claim RPCs return more columns than handlers consume.** Q2 → NI-017. `claim_summarizing_meeting` returns `youtube_id` unread by `runSummarizationOnce`; `claim_segmenting_meeting` returns `duration_seconds` unread by `runSegmentationOnce`. Spare-column cost negligible at v1 scale; intentional schema insulation against future handler additions.
- **SPEC's parameter-naming convention drops the `p_` prefix.** SPEC describes RPCs as `complete_summarization(meeting_id uuid, summary text)` while the migration declares `p_meeting_id uuid, p_summary text`. The handler at `apps/worker/src/pipeline/summarize.ts:163-166` uses the migration-correct names. Convention is consistent across all SPEC RPC mentions (Slice 3's `complete_segmentation()` is similarly described without args, and the migration's parameter names use the same `p_` prefix). SPEC abstracts intent; migration is source of truth for SQL identifiers.
- **SPEC's "Postgres 14+ permits ALTER TYPE ADD VALUE inside a transaction" framing.** The claim is factually true. The deeper rationale — that the new value cannot appear as a *literal* in same-transaction DML, but CREATE FUNCTION bodies are safe via deferred plpgsql resolution — lives in the migration's own header comment at `supabase/migrations/20260510141247_slice_4_summarization_schema.sql:21-24`, exactly where a contributor modifying the migration would land. The two texts together are correct; reframing SPEC would be redundant.
- **Fix-brief illustrative snippet uses `@duly-noted/shared/summarization/constants` subpath.** `packages/shared/package.json` declares only the root `"."` export. The snippet at `2026-05-10-slice-4-summarization-fix-brief.md:27` is explicitly framed as "Suggested shape (adjust to file's existing import style and helpers)" and the implementor adapted correctly: the actually-applied code at `apps/worker/src/pipeline/summarize.ts:4-12` uses the top-level `'@duly-noted/shared'` barrel. Templates communicate intent; this template did. Editing fix-briefs after-the-fact also conflicts with the audit-trail durability convention.
- **SPEC §Stage 6 §State transition omits column-by-column claim RPC return shape.** Per CLAUDE.md §1, SPEC describes architecture; column-level shape lives in the migration. SPEC's "returns the row" abstraction is consistent with the Slice 3 narrative the new text is anchored to ("paralleling Slice 3's claim_segmenting_meeting() / complete_segmentation() pair").

## Suggested fix order

1. **F1** — propagate the `summarizing → published` shape from refined §Stage 6 to the two upstream SPEC sections still carrying the legacy `summarizing → review → published` flow:
   - `SPEC.md:26`: rewrite the second sentence of the worker bullet to "auto-advances `summarizing → published`. The `review` enum slot is reserved for a future operator review UI slice (see Backlog B4); no row sits in `review` at v1."
   - `SPEC.md:119`: rewrite the closure to "closed in Stage 6 below: v1 auto-advances `summarizing → published`. Operator review gate deferred (Backlog B4); the `review` state slot is preserved in the enum for that slice."
   Then triage Q1.

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| HIGH     | 0     |
| MEDIUM   | 1     |
| LOW      | 0     |
| NIT      | 0     |

- Findings: 1 (F1, MEDIUM, confidence 95)
- Questions for human: 1 (Q1, NI-016 transcription error vs. registry never-edit convention)
- Findings dropped by verification: 4 — (a) P1 candidate "SPEC.md:464 PG14+ rationale misframing" verified false (loose framing, not factually wrong; precise rule lives in the migration's own header comment); (b) P3 candidate "SPEC.md:478 drops `p_` prefix" verified false (consistent SPEC convention); (c) P3 candidate "SPEC.md:290 omits claim RPC return columns" verified false (consistent SPEC convention; CLAUDE.md §1 puts column shape in SQL); (d) P6 candidate "fix-brief subpath import in illustrative snippet" verified false (template explicitly invites adaptation; implementor adapted correctly).
- Findings suppressed by `_known-non-issues.md`: 0.

The F1 fix application is materially correct: both summarization and segmentation paths now satisfy SPEC §Stage 6's length-bound `last_error` requirement, with tests asserting the enriched-message contract on both `too_small` (summary) and `too_big` (title) directions. The SPEC refinement (`1a8a895`) accurately describes the as-built two-RPC pattern and the entity-grounding v1 deviation from the Oberoi pattern, but did not propagate the `summarizing → published` change beyond §Stage 6 — the resulting two stale SPEC locations are the substantive finding of this reaudit. The audit-trail commit is well-formed: source audit, fix-brief, and registry NIs all land together with correct cross-references.
