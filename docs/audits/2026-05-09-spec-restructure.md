---
date: 2026-05-09
scope: SPEC.md → ADR restructure (Decision Records extracted to one ADR per decision; @SPEC.md import dropped from CLAUDE.md; yt-dlp residential proxy gap-fill ADR added)
commit_range: fecc590..HEAD
head_sha: e9bc8f3
prior_audit: 2026-05-08-reaudit-fix-brief.md
known_non_issues_consulted: true
audit_method: parallel-subagents-with-verification
passes_run: P1, P2, P3, P4, P5, P6
findings_count: 1
questions_count: 2
findings_dropped_by_verification: 0
findings_filtered_by_known_non_issues: 0
---

# Audit — SPEC.md → ADR restructure (2026-05-09)

Docs-only restructure: 18 new ADRs (`0002-0019`), one of which is a
gap-fill (`0019` yt-dlp residential proxy). SPEC.md Decision Records
for Stages 1–4 replaced with bold-inline `**Locked decisions:**`
pointers. CLAUDE.md `@SPEC.md` import dropped, replaced with a
progressive-disclosure pointer. `docs/workflows/build-cycle.md`
amended to note ADRs as canonical home for locked decisions.

## Mechanical pass results

| Check | Result |
|---|---|
| `pnpm format:check` | clean |
| `pnpm -r lint` | not run (no code changed) |
| `pnpm -r typecheck` | not run (no code changed) |
| `pnpm -r test` | not run (no code changed) |
| `git diff --shortstat fecc590..HEAD` | 21 files changed, 866 insertions(+), 49 deletions(-) |
| Code/schema/migration files touched | 0 (`.md` only) |
| New files > 500 LOC | 0 |
| Existing files growing > 200 LOC | 0 |
| Test ratio | N/A (no source files added) |

Skipped lint/typecheck/test because the changeset is exclusively
markdown. P3 (schema) and P5 (migration) confirmed independently
that no `*.sql` files or files under `supabase/migrations/` or
`packages/db/` changed.

## Findings

### F1 — ADR 0014 drops the "3/3-corroborated baseline" justification

- **Severity:** MEDIUM
- **Source:** P1
- **File:line:** `docs/adr/0014-adapted-oberoi-three-step-pipeline.md` (entire file; the missing claim has no host line)
- **Finding:** ADR 0014's Context section frames Oberoi as a single
  source ("The reference work is Oberoi's citymeetings.nyc"). The
  pre-restructure SPEC.md row 4.1 Reason cell led with "Three-step is
  3/3-corroborated baseline" — project shorthand meaning three
  independent sources confirmed the approach. Neither the literal
  phrase nor any equivalent framing ("multiple independent sources",
  "corroborated across N references", etc.) appears anywhere in the
  ADR.
- **Evidence:**
  - Pre-restructure SPEC.md row 4.1 Reason (`git show fecc590:SPEC.md`):
    "Three-step is 3/3-corroborated baseline. Single-pass was Oberoi's
    abandoned failure mode. Operator section-marking requires UI not
    built until later slice. TreeSeg unproven in production at this
    domain."
  - ADR 0014 Context describes only Oberoi's history (March 2024
    baseline vs current operator section-marking), not the
    corroboration strength.
  - SPEC.md still uses "3/3-corroborated" elsewhere (line 234, for
    T-tokens in ADR 0016's territory), so the shorthand is still live
    in the project — the loss is row-4.1-specific.
- **Verification reasoning:** Verifier ran the disprove pass and
  could not find equivalent phrasing in 0014. Historical framing
  (March 2024 vs current Oberoi approach) answers a different
  question — "why this rather than Oberoi's own alternatives" — than
  evidence strength — "how confident is the project in this
  approach." A future reader of 0014 would conclude the choice rests
  on a single source rather than three corroborating ones.
- **Confidence:** 88

## Questions for human

### Q1 — Should ADR 0007 cite "Supabase's recommended pattern" as vendor-alignment justification?

- **Source:** P1 (verified false-positive; moved to Questions)
- **File:line:** `docs/adr/0007-migrations-via-github-action.md`
- **Question:** The pre-restructure SPEC.md row 1.7 Reason said
  "Forward-only migrations match Supabase's recommended pattern."
  ADR 0007 keeps the forward-only rule and explains it via the
  no-`down`-scripts consequence and the backwards-compatibility
  framework, but doesn't cite the Supabase vendor-alignment basis.
  Does the omission matter?
- **Evidence:** ADR 0007 Decision: "Migrations are forward-only and
  must be backwards-compatible with the previously deployed worker
  (additive ahead of consuming code; expand/contract for destructive
  changes)." Consequences: "Rollback is by writing a forward
  migration that undoes — no `down` scripts." Pre-restructure SPEC
  row 1.7: "Keeps schema concerns off the runtime path. Forward-only
  migrations match Supabase's recommended pattern."
- **Why this needs human input:** The vendor-alignment clause is a
  corroborating rationale, not load-bearing. The ADR's standalone
  argument holds. But content fidelity in the extraction was the
  user's stated risk-to-watch. Restoring one sentence is cheap;
  declining is also defensible. Author judgment.

### Q2 — Should ADR 0008 explicitly state "cheapest with diarization in this tier"?

- **Source:** P1 (verified low confidence + should_be_question;
  moved to Questions)
- **File:line:** `docs/adr/0008-assemblyai-universal-3-pro.md`
- **Question:** The pre-restructure SPEC.md row 2.1 Reason said
  "$0.21/hr cheapest with diarization in this tier; data opt-out
  available." ADR 0008 lists Universal-3 Pro at $0.21/hr and
  characterizes each alternative ("comparable price tier",
  "human-transcription tier", "no diarization"), but never asserts
  the cheapest-in-tier ranking. Should the ranking be restated, or
  does the per-alternative characterization carry enough?
- **Evidence:** ADR 0008 Considered options bullets describe each
  vendor with one or two qualifiers; reader can reconstruct "among
  the cheapest with diarization" but not strictly "cheapest" because
  Deepgram Nova-3 is described as "comparable price tier" without
  specifying which side of comparable.
- **Why this needs human input:** Verifier flagged that the
  cheapest-in-tier claim was weakly supported even in the original
  (Deepgram is "comparable", not "more expensive"). Author may have
  intentionally softened this rather than quote a phrase that
  doesn't survive its own evidence. The load-bearing rationale —
  diarization included, competitive WER, $0.06/hr Universal-2 premium
  acceptable at ~$10/year volume — is fully preserved.

## Reopen candidates

None. The restructure does not surface any prior NI-NNN entry as
worth revisiting.

## What NOT to fix (this audit)

- The retention of the bold-inline `**Locked decisions:**` pointer
  style in SPEC.md is intentional and matches both the original
  prompt's example and SPEC.md's existing prose style (`**Vendor:**`,
  `**Submit pattern.**`, etc.). Don't convert these back to `##`
  headings.
- Backticks around `SPEC.md` and `docs/adr/` in CLAUDE.md's
  "Pulling architectural context" block deviate from the prompt's
  literal text but match project file-citation style. Leave.
- `docs/audits/2026-05-06-spine-scaffold-3.md:148` references
  "SPEC.md Decision Record open items" — this is a historical audit
  describing pre-restructure state. Audits are append-only; do not
  edit. P4 surfaced this and correctly classified it as by-design.

## Suggested fix order

1. **F1** (ADR 0014 corroboration signal) — single-line addition to
   ADR 0014 Context restoring the "3/3-corroborated" framing or
   equivalent. ~2 minutes.

If Q1 and Q2 land as fix-now after triage, fold them into the same
session as F1 — all three are sentence-level rationale restorations
in three different ADRs.

## Summary

| Bucket | Count |
|---|---|
| Findings | 1 |
| Questions | 2 |
| Reopen candidates | 0 |
| Findings dropped by verification | 0 (verifier moved 2 to Questions) |
| Findings suppressed by `_known-non-issues.md` | 0 |
| Severity breakdown | 1 MEDIUM, 0 BLOCKER/HIGH/LOW/NIT |

Restructure is structurally clean. All four `**Locked decisions:**`
pointers in SPEC.md correctly span the ADRs they reference. All 18
new ADR files exist with the full MADR section structure (Date,
Status, Context, Considered options, Decision, Consequences). Cross-
ADR references resolve. Internal file-path claims (`apps/worker/
Dockerfile`, `supabase/functions/asr-webhook/index.ts`,
`packages/shared/src/segmentation/*`) are consistent with the
codebase. Env-var claims align with SPEC.md's per-surface secret
table. ADR dates are plausible per the git log of SPEC.md commits.

The single MEDIUM finding and two Questions are sentence-level
rationale drops in three different ADRs — they do not change any
locked decision but they slightly weaken the recoverable "why"
trail. None are blocking. All three are addressable in a ~5-minute
follow-up if triaged as fix-now.
